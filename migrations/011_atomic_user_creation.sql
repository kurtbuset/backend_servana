-- Migration: Atomic user creation RPCs
-- Wraps admin and agent creation in database-level transactions
-- to prevent orphaned records on partial failure.

-- Create admin atomically: profile + sys_user in one transaction
-- (Auth user is created via Supabase Auth API separately, so it's excluded)
CREATE OR REPLACE FUNCTION create_admin_atomic(
  p_email TEXT,
  p_role_id INT,
  p_created_by INT,
  p_supabase_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_prof_id INT;
  v_sys_user_id INT;
  v_result JSON;
BEGIN
  -- Step 1: Create profile
  INSERT INTO profile (prof_firstname, prof_lastname, prof_created_at)
  VALUES ('', '', NOW())
  RETURNING prof_id INTO v_prof_id;

  -- Step 2: Create sys_user linked to profile
  INSERT INTO sys_user (
    sys_user_email,
    sys_user_is_active,
    role_id,
    prof_id,
    sys_user_created_by,
    sys_user_updated_by,
    supabase_user_id
  )
  VALUES (
    p_email,
    TRUE,
    p_role_id,
    v_prof_id,
    p_created_by,
    p_created_by,
    p_supabase_user_id
  )
  RETURNING sys_user_id INTO v_sys_user_id;

  SELECT json_build_object(
    'sys_user_id', v_sys_user_id,
    'sys_user_email', p_email,
    'sys_user_is_active', TRUE,
    'supabase_user_id', p_supabase_user_id,
    'prof_id', v_prof_id
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Create agent atomically: profile + sys_user + department links in one transaction
CREATE OR REPLACE FUNCTION create_agent_atomic(
  p_email TEXT,
  p_role_id INT,
  p_supabase_user_id UUID,
  p_dept_ids INT[] DEFAULT '{}'
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_prof_id INT;
  v_sys_user_id INT;
  v_dept_id INT;
  v_result JSON;
BEGIN
  -- Step 1: Create profile
  INSERT INTO profile (prof_firstname, prof_lastname, prof_created_at)
  VALUES ('', '', NOW())
  RETURNING prof_id INTO v_prof_id;

  -- Step 2: Create sys_user linked to profile
  INSERT INTO sys_user (
    sys_user_email,
    sys_user_is_active,
    supabase_user_id,
    prof_id,
    sys_user_created_at,
    role_id
  )
  VALUES (
    p_email,
    TRUE,
    p_supabase_user_id,
    v_prof_id,
    NOW(),
    p_role_id
  )
  RETURNING sys_user_id INTO v_sys_user_id;

  -- Step 3: Insert department links
  IF array_length(p_dept_ids, 1) IS NOT NULL THEN
    FOREACH v_dept_id IN ARRAY p_dept_ids
    LOOP
      INSERT INTO sys_user_department (sys_user_id, dept_id)
      VALUES (v_sys_user_id, v_dept_id);
    END LOOP;
  END IF;

  SELECT json_build_object(
    'sys_user_id', v_sys_user_id,
    'sys_user_email', p_email,
    'prof_id', v_prof_id
  ) INTO v_result;

  RETURN v_result;
END;
$$;
