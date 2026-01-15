-- Test Data for Queue System
-- Run this in your Supabase SQL Editor

-- 1. Check if you have any chat_groups
SELECT * FROM chat_group;

-- 2. Check if you have clients
SELECT * FROM client;

-- 3. Check if you have departments
SELECT * FROM department;

-- 4. If you need to create a test client (adjust values as needed)
-- First, create a profile
INSERT INTO profile (prof_firstname, prof_lastname, prof_address)
VALUES ('Test', 'Client', '123 Test St')
RETURNING prof_id;

-- Use the prof_id from above in the next query
-- INSERT INTO client (client_number, client_country_code, client_password, prof_id)
-- VALUES ('+1234567890', '+1', 'hashed_password_here', <prof_id_from_above>)
-- RETURNING client_id;

-- 5. Create a test chat_group (use actual client_id and dept_id)
-- INSERT INTO chat_group (client_id, dept_id, sys_user_id, chat_group_name)
-- VALUES (<client_id>, <dept_id>, NULL, 'Test Chat')
-- RETURNING chat_group_id;

-- 6. Add a test message to the chat_group
-- INSERT INTO chat (chat_group_id, client_id, sys_user_id, chat_body, chat_created_at)
-- VALUES (<chat_group_id>, <client_id>, NULL, 'Hello, I need help!', NOW());

-- 7. Verify the data
SELECT 
  cg.chat_group_id,
  cg.sys_user_id,
  c.client_number,
  p.prof_firstname,
  p.prof_lastname,
  d.dept_name
FROM chat_group cg
JOIN client c ON cg.client_id = c.client_id
JOIN profile p ON c.prof_id = p.prof_id
JOIN department d ON cg.dept_id = d.dept_id
WHERE cg.sys_user_id IS NULL;
