# Privilege-Based Access Control Mapping

This document outlines which privileges are required for each API endpoint.

## Privilege Definitions

Based on the `privilege` table, here are the available privileges:

- `priv_can_view_message` - Can view chat messages
- `priv_can_message` - Can send messages
- `priv_can_manage_profile` - Can edit profile information
- `priv_can_use_canned_mess` - Can use canned messages/macros
- `priv_can_end_chat` - Can end chat sessions
- `priv_can_transfer` - Can transfer chats between departments
- `priv_can_manage_dept` - Can manage departments
- `priv_can_assign_dept` - Can assign users to departments
- `priv_can_manage_role` - Can manage roles and permissions
- `priv_can_assign_role` - Can assign roles to users
- `priv_can_create_account` - Can create new user accounts
- `priv_can_manage_auto_reply` - Can manage auto-reply messages

## API Endpoint Privilege Requirements

### Agent Management (`/api/agents`)
- `GET /agents` - Requires: `priv_can_manage_role` OR `priv_can_create_account`
- `POST /agents` - Requires: `priv_can_create_account`
- `PUT /agents/:id` - Requires: `priv_can_manage_role`
- `GET /departments` - Requires: `priv_can_manage_dept`

### Role Management (`/api/roles`)
- `GET /` - Requires: `priv_can_manage_role`
- `POST /` - Requires: `priv_can_manage_role`
- `PUT /:id` - Requires: `priv_can_manage_role`
- `GET /:roleId/members` - Requires: `priv_can_manage_role`
- `PUT /:roleId/members/:userId/permissions` - Requires: `priv_can_manage_role`

### Department Management (`/api/departments`)
- `GET /` - Requires: `priv_can_manage_dept`
- `POST /` - Requires: `priv_can_manage_dept`
- `PUT /:id` - Requires: `priv_can_manage_dept`
- `PUT /:id/toggle` - Requires: `priv_can_manage_dept`
- `GET /:id/members` - Requires: `priv_can_manage_dept`

### Admin Management (`/api/admin`)
- `GET /` - Requires: `priv_can_create_account`
- `POST /` - Requires: `priv_can_create_account`
- `PUT /:id` - Requires: `priv_can_create_account`
- `PUT /:id/toggle` - Requires: `priv_can_create_account`

### Auto Reply Management (`/api/auto-replies`)
- `GET /` - Requires: `priv_can_manage_auto_reply`
- `GET /departments/active` - Requires: `priv_can_manage_auto_reply`
- `GET /departments/all` - Requires: `priv_can_manage_auto_reply`
- `POST /` - Requires: `priv_can_manage_auto_reply`
- `PUT /:id` - Requires: `priv_can_manage_auto_reply`

### Profile Management (`/api/profile`)
- `GET /` - No special privilege required (users can view their own profile)
- `PUT /` - Requires: `priv_can_manage_profile`
- `PUT /image` - Requires: `priv_can_manage_profile`

## Security Implementation

### Middleware Chain
1. `getCurrentUser` - Authenticates user and sets `req.userId`
2. `checkPermission(privilege)` - Verifies user has required privilege
3. Controller method - Executes business logic

### Permission Check Flow
```javascript
// 1. Get user's role_id from sys_user table
// 2. Get role's priv_id from role table  
// 3. Check specific privilege in privilege table
// 4. Allow/deny access based on privilege value
```

### Error Responses
- `401` - User not authenticated
- `403` - User lacks required privilege
- `500` - Permission check failed

## Usage Examples

```javascript
// Single permission check
router.get("/agents", 
  checkPermission('priv_can_manage_role'),
  (req, res) => this.getAllAgents(req, res)
);

// Multiple permission check (OR logic)
router.get("/agents", 
  checkAnyPermission(['priv_can_manage_role', 'priv_can_create_account']),
  (req, res) => this.getAllAgents(req, res)
);
```

## Notes

- All routes require authentication via `getCurrentUser` middleware
- Privileges are checked against the authenticated user's role
- Service role key bypasses all privilege checks (admin access)
- Mobile endpoints may have different privilege requirements