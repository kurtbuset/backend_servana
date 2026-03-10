#!/usr/bin/env node

/**
 * Fix Macro Permissions Script
 * 
 * This script ensures that:
 * 1. The new macro permission columns exist in the privilege table
 * 2. Existing users with priv_can_use_canned_mess get the new granular permissions
 * 3. All privilege records have the new columns (even if set to false)
 */

const supabase = require("../helpers/supabaseClient");

async function fixMacroPermissions() {
  console.log("🔧 Starting macro permissions fix...");

  try {
    // Step 1: Add the new columns if they don't exist
    console.log("📋 Step 1: Adding new macro permission columns...");
    
    const addColumnsQuery = `
      ALTER TABLE privilege 
      ADD COLUMN IF NOT EXISTS priv_can_view_macros BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS priv_can_add_macros BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS priv_can_edit_macros BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS priv_can_delete_macros BOOLEAN DEFAULT FALSE;
    `;
    
    const { error: alterError } = await supabase.rpc('exec_sql', { 
      sql: addColumnsQuery 
    });
    
    if (alterError) {
      console.error("❌ Failed to add columns:", alterError);
      console.log("⚠️ Please run the migration manually:");
      console.log("   ALTER TABLE privilege ADD COLUMN IF NOT EXISTS priv_can_view_macros BOOLEAN DEFAULT FALSE;");
      console.log("   ALTER TABLE privilege ADD COLUMN IF NOT EXISTS priv_can_add_macros BOOLEAN DEFAULT FALSE;");
      console.log("   ALTER TABLE privilege ADD COLUMN IF NOT EXISTS priv_can_edit_macros BOOLEAN DEFAULT FALSE;");
      console.log("   ALTER TABLE privilege ADD COLUMN IF NOT EXISTS priv_can_delete_macros BOOLEAN DEFAULT FALSE;");
    } else {
      console.log("✅ Columns added successfully");
    }

    // Step 2: Update existing records
    console.log("📋 Step 2: Updating existing privilege records...");
    
    // Get all privilege records that have priv_can_use_canned_mess = true
    const { data: privilegesToUpdate, error: fetchError } = await supabase
      .from('privilege')
      .select('priv_id, priv_can_use_canned_mess, priv_can_view_macros, priv_can_add_macros, priv_can_edit_macros, priv_can_delete_macros')
      .eq('priv_can_use_canned_mess', true);
    
    if (fetchError) {
      console.error("❌ Failed to fetch privilege records:", fetchError);
      return;
    }
    
    console.log(`📋 Found ${privilegesToUpdate.length} records with priv_can_use_canned_mess = true`);
    
    // Update records that need the new permissions
    for (const priv of privilegesToUpdate) {
      const needsUpdate = 
        priv.priv_can_view_macros !== true || 
        priv.priv_can_add_macros !== true || 
        priv.priv_can_edit_macros !== true ||
        priv.priv_can_delete_macros !== true;
        
      if (needsUpdate) {
        console.log(`🔄 Updating privilege record ${priv.priv_id}...`);
        
        const { error: updateError } = await supabase
          .from('privilege')
          .update({
            priv_can_view_macros: true,
            priv_can_add_macros: true,
            priv_can_edit_macros: true,
            priv_can_delete_macros: true
          })
          .eq('priv_id', priv.priv_id);
          
        if (updateError) {
          console.error(`❌ Failed to update privilege ${priv.priv_id}:`, updateError);
        } else {
          console.log(`✅ Updated privilege ${priv.priv_id}`);
        }
      } else {
        console.log(`✅ Privilege ${priv.priv_id} already has correct permissions`);
      }
    }

    // Step 3: Ensure all privilege records have the new columns (set to false if null)
    console.log("📋 Step 3: Ensuring all records have the new columns...");
    
    const { error: nullUpdateError } = await supabase
      .from('privilege')
      .update({
        priv_can_view_macros: false,
        priv_can_add_macros: false,
        priv_can_edit_macros: false,
        priv_can_delete_macros: false
      })
      .or('priv_can_view_macros.is.null,priv_can_add_macros.is.null,priv_can_edit_macros.is.null,priv_can_delete_macros.is.null');
    
    if (nullUpdateError) {
      console.error("❌ Failed to update null values:", nullUpdateError);
    } else {
      console.log("✅ All privilege records now have the new macro columns");
    }

    console.log("🎉 Macro permissions fix completed successfully!");
    
  } catch (error) {
    console.error("❌ Unexpected error:", error);
  }
}

// Run the script
if (require.main === module) {
  fixMacroPermissions()
    .then(() => {
      console.log("✅ Script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = { fixMacroPermissions };