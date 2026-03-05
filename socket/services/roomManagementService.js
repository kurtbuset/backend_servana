const supabase = require('../../helpers/supabaseClient');

/**
 * Room Management Service
 * Handles business logic for room management (joining agents to department rooms)
 */
class RoomManagementService {
  /**
   * Join agent to their department rooms for receiving customer list updates
   */
  static async joinDepartmentRooms(socket) {
    try {
      if (!socket.user || socket.user.userType !== 'agent') {
        return;
      }

      // Get agent's departments
      const { data: userDepartments, error } = await supabase
        .from('sys_user_department')
        .select('dept_id')
        .eq('sys_user_id', socket.user.userId);

      if (error || !userDepartments) {
        console.error('❌ Error getting agent departments for room joining:', error);
        return;
      }

      // Join department rooms
      userDepartments.forEach(dept => {
        const departmentRoom = `department_${dept.dept_id}`;
        socket.join(departmentRoom);
      });

      // Also join individual agent room
      const agentRoom = `agent_${socket.user.userId}`;
      socket.join(agentRoom);

      console.log(`✅ Agent ${socket.user.userId} joined ${userDepartments.length} department rooms`);

    } catch (error) {
      console.error('❌ Error joining department rooms:', error);
    }
  }
}

module.exports = RoomManagementService;
