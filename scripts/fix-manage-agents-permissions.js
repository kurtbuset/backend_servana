#!/usr/bin/env node

/**
 * Migration Script: Fix Manage Agents Permissions
 * 
 * This script helps set up the new granular manage agents permissions
 * for existing roles that should have access to manage agents functionality.
 * 
 * Usage: node scripts/fix-manage-agents-permissions.js
 */

const supabase = require("../helpers/supabaseClient");

async function fixManageAgentsPermissions() {
  console.log("🔧 Starting manage agents permissions migration...");

  try {
    // Get all roles that should have manage agents permissions
    // (roles that currently have account creation or role management permissions)
    const { data: rolesToUpdate, error: rolesError } = await supabase
      .from("privilege")
      .select(`
        priv_id,
        priv_can_create_account,
        priv_can_manage_role,
        priv_can_view_manage_agents,
        priv_can_view_agents_info,
        priv_can_create_agent_account,
        priv_can_edit_manage_agents,
        priv_can_edit_dept_manage_agents,
        priv_can_view_analytics_manage_agents,
        role:role!inner(role_name)
      `)
      .or("priv_can_create_account.eq.true,priv_can_manage_role.eq.true");

    if (rolesError) {
      throw rolesError;
    }

    console.log(`📋 Found ${rolesToUpdate.length} roles that may need manage agents permissions`);

    let updatedCount = 0;

    for (const privilege of rolesToUpdate) {
      const roleName = privilege.role[0]?.role_name || "Unknown";
      
      // Check if any of the new permissions are already set
      const hasNewPermissions = 
        privilege.priv_can_view_manage_agents ||
        privilege.priv_can_view_agents_info ||
        privilege.priv_can_create_agent_account ||
        privilege.priv_can_edit_manage_agents ||
        privilege.priv_can_edit_dept_manage_agents ||
        privilege.priv_can_view_analytics_manage_agents;

      if (hasNewPermissions) {
        console.log(`⏭️  Skipping role "${roleName}" - already has new permissions`);
        continue;
      }

      // Update the privilege with new manage agents permissions
      const { error: updateError } = await supabase
        .from("privilege")
        .update({
          priv_can_view_manage_agents: true,
          priv_can_view_agents_info: true,
          priv_can_create_agent_account: true,
          priv_can_edit_manage_agents: true,
          priv_can_edit_dept_manage_agents: true,
          priv_can_view_analytics_manage_agents: true,
        })
        .eq("priv_id", privilege.priv_id);

      if (updateError) {
        console.error(`❌ Failed to update role "${roleName}":`, updateError.message);
        continue;
      }

      console.log(`✅ Updated role "${roleName}" with manage agents permissions`);
      updatedCount++;
    }

    console.log(`\n🎉 Migration completed successfully!`);
    console.log(`📊 Updated ${updatedCount} roles with new manage agents permissions`);
    
    if (updatedCount > 0) {
      console.log(`\n📝 New permissions added:`);
      console.log(`   • Can View Manage Agents - View the manage agents screen and agent list`);
      console.log(`   • Can View Agents Information - View detailed agent information and profiles`);
      console.log(`   • Can Create Agent Account - Create new agent accounts`);
      console.log(`   • Can Edit Manage Agents - Edit agent details and settings`);
      console.log(`   • Can Edit Department Manage Agents - Edit agent department assignments`);
      console.log(`   • Can View Analytics Manage Agents - View agent analytics and performance data`);
    }

  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

// Run the migration
if (require.main === module) {
  fixManageAgentsPermissions()
    .then(() => {
      console.log("\n✨ All done! Users with updated roles can now access manage agents features.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Unexpected error:", error);
      process.exit(1);
    });
}

module.exports = { fixManageAgentsPermissions };