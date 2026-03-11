#!/usr/bin/env node

/**
 * Fix Department Permissions Script
 * 
 * This script ensures that:
 * 1. The new department permission columns exist in the privilege table
 * 2. Existing users with priv_can_manage_dept get the new granular permissions
 * 3. All privilege records have the new columns (even if set to false)
 */

const supabase = require("../helpers/supabaseClient");

async function fixDepartmentPermissions() {
  console.log("🔧 Starting department permissions fix...");

  try {
    // Step 1: Add the new columns if they don't exist
    console.log("📋 Step 1: Adding new permission columns...");
    
    const addColumnsQuery = `
      ALTER TABLE privilege 
      ADD COLUMN IF NOT EXISTS priv_can_view_dept BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS priv_can_add_dept BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS priv_can_edit_dept BOOLEAN DEFAULT FALSE;
    `;
    
    const { error: alterError } = await supabase.rpc('exec_sql', { 
      sql: addColumnsQuery 
    });
    
    if (alterError) {
      console.error("❌ Failed to add columns:", alterError);
      // Try alternative approach
      console.log("🔄 Trying alternative approach...");
      
      // Check if columns exist first
      const { data: columns, error: checkError } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'privilege')
        .in('column_name', ['priv_can_view_dept', 'priv_can_add_dept', 'priv_can_edit_dept']);
        
      if (checkError) {
        console.error("❌ Failed to check columns:", checkError);
      } else {
        const existingColumns = columns.map(c => c.column_name);
        console.log("📋 Existing columns:", existingColumns);
        
        if (existingColumns.length < 3) {
          console.log("⚠️ Some columns are missing. Please run the migration manually:");
          console.log("   ALTER TABLE privilege ADD COLUMN IF NOT EXISTS priv_can_view_dept BOOLEAN DEFAULT FALSE;");
          console.log("   ALTER TABLE privilege ADD COLUMN IF NOT EXISTS priv_can_add_dept BOOLEAN DEFAULT FALSE;");
          console.log("   ALTER TABLE privilege ADD COLUMN IF NOT EXISTS priv_can_edit_dept BOOLEAN DEFAULT FALSE;");
        }
      }
    } else {
      console.log("✅ Columns added successfully");
    }

    // Step 2: Update existing records
    console.log("📋 Step 2: Updating existing privilege records...");
    
    // Get all privilege records that have priv_can_manage_dept = true
    const { data: privilegesToUpdate, error: fetchError } = await supabase
      .from('privilege')
      .select('priv_id, priv_can_manage_dept, priv_can_view_dept, priv_can_add_dept, priv_can_edit_dept')
      .eq('priv_can_manage_dept', true);
    
    if (fetchError) {
      console.error("❌ Failed to fetch privilege records:", fetchError);
      return;
    }
    
    console.log(`📋 Found ${privilegesToUpdate.length} records with priv_can_manage_dept = true`);
    
    // Update records that need the new permissions
    for (const priv of privilegesToUpdate) {
      const needsUpdate = 
        priv.priv_can_view_dept !== true || 
        priv.priv_can_add_dept !== true || 
        priv.priv_can_edit_dept !== true;
        
      if (needsUpdate) {
        console.log(`🔄 Updating privilege record ${priv.priv_id}...`);
        
        const { error: updateError } = await supabase
          .from('privilege')
          .update({
            priv_can_view_dept: true,
            priv_can_add_dept: true,
            priv_can_edit_dept: true
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
        priv_can_view_dept: false,
        priv_can_add_dept: false,
        priv_can_edit_dept: false
      })
      .or('priv_can_view_dept.is.null,priv_can_add_dept.is.null,priv_can_edit_dept.is.null');
    
    if (nullUpdateError) {
      console.error("❌ Failed to update null values:", nullUpdateError);
    } else {
      console.log("✅ All privilege records now have the new columns");
    }

    console.log("🎉 Department permissions fix completed successfully!");
    
  } catch (error) {
    console.error("❌ Unexpected error:", error);
  }
}

// Run the script
if (require.main === module) {
  fixDepartmentPermissions()
    .then(() => {
      console.log("✅ Script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = { fixDepartmentPermissions };