-- Servana Database Schema - Actual Production Schema
-- Uses bigint/bigserial for primary keys

-- Profile table (must be created first as it's referenced by others)
CREATE TABLE IF NOT EXISTS public.profile (
    prof_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    prof_firstname text NOT NULL,
    prof_middlename text NULL,
    prof_lastname text NOT NULL,
    prof_address text NULL,
    prof_date_of_birth date NULL,
    prof_street_address text NULL,
    prof_region_info text NULL,
    prof_postal_code text NULL,
    prof_updated_at timestamp without time zone NULL DEFAULT now(),
    CONSTRAINT profile_pkey PRIMARY KEY (prof_id)
);

-- Privilege table
CREATE TABLE IF NOT EXISTS public.privilege (
    priv_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    priv_can_view_message boolean NOT NULL,
    priv_can_message boolean NULL,
    priv_can_manage_profile boolean NULL,
    priv_can_use_canned_mess boolean NULL,
    priv_can_end_chat boolean NULL,
    priv_can_transfer boolean NULL,
    priv_can_manage_dept boolean NULL,
    priv_can_assign_dept boolean NULL,
    priv_can_manage_role boolean NULL,
    priv_can_assign_role boolean NULL,
    priv_can_create_account boolean NULL,
    priv_can_manage_auto_reply boolean NULL,
    priv_created_at timestamp without time zone NULL DEFAULT now(),
    priv_created_by bigint NULL,
    priv_updateed_at timestamp without time zone NULL DEFAULT now(),
    priv_updated_by bigint NULL,
    CONSTRAINT privilage_pkey PRIMARY KEY (priv_id)
);

-- Role table
CREATE TABLE IF NOT EXISTS public.role (
    role_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    role_name text NOT NULL,
    role_is_active boolean NULL DEFAULT true,
    role_created_at timestamp without time zone NULL DEFAULT now(),
    role_created_by bigint NULL,
    role_updated_at timestamp without time zone NULL,
    role_updated_by bigint NULL,
    priv_id bigint NULL,
    CONSTRAINT role_pkey PRIMARY KEY (role_id),
    CONSTRAINT role_priv_id_fkey FOREIGN KEY (priv_id) REFERENCES privilege (priv_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Department table
CREATE TABLE IF NOT EXISTS public.department (
    dept_id bigserial NOT NULL,
    dept_name text NOT NULL,
    dept_is_active boolean NULL DEFAULT true,
    dept_created_at timestamp without time zone NULL DEFAULT now(),
    dept_created_by bigint NULL,
    dept_updated_at timestamp without time zone NULL,
    dept_updated_by bigint NULL,
    CONSTRAINT department_pkey PRIMARY KEY (dept_id)
);

-- System User table
CREATE TABLE IF NOT EXISTS public.sys_user (
    sys_user_id bigserial NOT NULL,
    sys_user_email text NOT NULL,
    sys_user_created_at timestamp without time zone NULL DEFAULT now(),
    sys_user_created_by bigint NULL,
    sys_user_updated_at timestamp without time zone NULL,
    sys_user_updated_by bigint NULL,
    sys_user_is_active boolean NULL DEFAULT true,
    supabase_user_id uuid NULL,
    role_id bigint NULL,
    prof_id bigint NULL,
    last_seen timestamp with time zone NULL DEFAULT now(),
    CONSTRAINT sys_user_pkey PRIMARY KEY (sys_user_id),
    CONSTRAINT sys_user_prof_id_fkey FOREIGN KEY (prof_id) REFERENCES profile (prof_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT sys_user_role_id_fkey FOREIGN KEY (role_id) REFERENCES role (role_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Client table
CREATE TABLE IF NOT EXISTS public.client (
    client_id bigserial NOT NULL,
    client_country_code text NOT NULL,
    client_number text NOT NULL,
    client_password text NOT NULL,
    client_created_at timestamp without time zone NULL DEFAULT now(),
    prof_id bigint NULL,
    client_updated_at timestamp without time zone NULL,
    client_is_active boolean NULL,
    client_is_verified boolean NULL,
    role_id bigint NULL,
    CONSTRAINT client_pkey PRIMARY KEY (client_id),
    CONSTRAINT client_client_number_key UNIQUE (client_number),
    CONSTRAINT client_prof_id_fkey FOREIGN KEY (prof_id) REFERENCES profile (prof_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT client_role_id_fkey FOREIGN KEY (role_id) REFERENCES role (role_id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Chat Group table
CREATE TABLE IF NOT EXISTS public.chat_group (
    chat_group_id bigserial NOT NULL,
    client_id bigint NOT NULL,
    dept_id bigint NULL,
    created_at timestamp without time zone NULL DEFAULT now(),
    status text NULL,
    sys_user_id bigint NULL,
    CONSTRAINT chat_group_pkey PRIMARY KEY (chat_group_id),
    CONSTRAINT chat_group_client_id_fkey FOREIGN KEY (client_id) REFERENCES client (client_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chat_group_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES department (dept_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chat_group_sys_user_id_fkey FOREIGN KEY (sys_user_id) REFERENCES sys_user (sys_user_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Chat table
CREATE TABLE IF NOT EXISTS public.chat (
    chat_id bigserial NOT NULL,
    chat_body text NULL,
    chat_created_at timestamp without time zone NULL DEFAULT CURRENT_TIMESTAMP,
    chat_is_read boolean NULL DEFAULT false,
    sys_user_id bigint NULL,
    client_id bigint NULL,
    chat_group_id bigint NULL,
    CONSTRAINT chat_pkey PRIMARY KEY (chat_id),
    CONSTRAINT chat_chat_group_id_fkey FOREIGN KEY (chat_group_id) REFERENCES chat_group (chat_group_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chat_client_id_fkey FOREIGN KEY (client_id) REFERENCES client (client_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chat_sys_user_id_fkey FOREIGN KEY (sys_user_id) REFERENCES sys_user (sys_user_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Auto Reply table
CREATE TABLE IF NOT EXISTS public.auto_reply (
    auto_reply_id bigint NOT NULL,
    auto_reply_message text NOT NULL,
    auto_reply_is_active boolean NULL DEFAULT true,
    auto_reply_created_at timestamp without time zone NULL DEFAULT CURRENT_TIMESTAMP,
    auto_reply_created_by bigint NULL,
    auto_reply_updated_at timestamp without time zone NULL DEFAULT CURRENT_TIMESTAMP,
    auto_reply_updated_by bigint NULL,
    dept_id bigint NULL,
    CONSTRAINT auto_reply_pkey PRIMARY KEY (auto_reply_id),
    CONSTRAINT auto_reply_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES department (dept_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Canned Message table
CREATE TABLE IF NOT EXISTS public.canned_message (
    canned_id bigserial NOT NULL,
    canned_message text NOT NULL,
    canned_is_active boolean NULL DEFAULT true,
    canned_created_at timestamp without time zone NULL DEFAULT now(),
    canned_created_by bigint NULL,
    canned_updated_at timestamp without time zone NULL,
    canned_updated_by bigint NULL,
    dept_id bigint NULL,
    role_id bigint NULL,
    CONSTRAINT canned_message_pkey PRIMARY KEY (canned_id),
    CONSTRAINT canned_message_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES department (dept_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT canned_message_role_id_fkey FOREIGN KEY (role_id) REFERENCES role (role_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- Image table
CREATE TABLE IF NOT EXISTS public.image (
    img_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    img_location text NOT NULL,
    img_is_current boolean NULL,
    img_created_at timestamp without time zone NULL DEFAULT now(),
    prof_id bigint NULL,
    CONSTRAINT image_pkey PRIMARY KEY (img_id),
    CONSTRAINT image_prof_id_fkey FOREIGN KEY (prof_id) REFERENCES profile (prof_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- System User Department junction table
CREATE TABLE IF NOT EXISTS public.sys_user_department (
    sys_user_id bigint NOT NULL,
    dept_id bigint NULL,
    id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    CONSTRAINT sys_user_department_pkey PRIMARY KEY (id),
    CONSTRAINT sys_user_department_id_key UNIQUE (id),
    CONSTRAINT sys_user_department_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES department (dept_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT sys_user_department_sys_user_id_fkey FOREIGN KEY (sys_user_id) REFERENCES sys_user (sys_user_id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- OTP SMS table
CREATE TABLE IF NOT EXISTS public.otp_sms (
    otp_id uuid NOT NULL DEFAULT gen_random_uuid(),
    phone_country_code character varying(10) NOT NULL,
    phone_number character varying(20) NOT NULL,
    otp_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    verified boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT otp_sms_pkey PRIMARY KEY (otp_id),
    CONSTRAINT otp_sms_phone_number_key UNIQUE (phone_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_chat_group_id ON chat(chat_group_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat(chat_created_at);
CREATE INDEX IF NOT EXISTS idx_chat_group_status ON chat_group(status);
CREATE INDEX IF NOT EXISTS idx_sys_user_email ON sys_user(sys_user_email);
CREATE INDEX IF NOT EXISTS idx_client_number ON client(client_number);
