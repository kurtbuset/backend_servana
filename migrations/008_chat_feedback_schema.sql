-- Chat Feedback Schema Migration
-- Adds table to store chat feedback and ratings from clients

-- Chat Feedback table
CREATE TABLE IF NOT EXISTS public.chat_feedback (
    feedback_id bigserial NOT NULL,
    chat_group_id bigint NOT NULL,
    client_id bigint NOT NULL,
    rating integer NULL CHECK (rating >= 1 AND rating <= 5),
    feedback_text text NULL,
    chat_duration_seconds integer NULL,
    message_count integer NULL,
    created_at timestamp without time zone NULL DEFAULT now(),
    CONSTRAINT chat_feedback_pkey PRIMARY KEY (feedback_id),
    CONSTRAINT chat_feedback_chat_group_id_fkey FOREIGN KEY (chat_group_id) REFERENCES chat_group (chat_group_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chat_feedback_client_id_fkey FOREIGN KEY (client_id) REFERENCES client (client_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chat_feedback_chat_group_unique UNIQUE (chat_group_id)
);

-- Add resolved_at timestamp to chat_group table
ALTER TABLE public.chat_group 
ADD COLUMN IF NOT EXISTS resolved_at timestamp without time zone NULL;

-- Add feedback_id reference to chat_group table (optional, for easy lookup)
ALTER TABLE public.chat_group 
ADD COLUMN IF NOT EXISTS feedback_id bigint NULL,
ADD CONSTRAINT chat_group_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES chat_feedback (feedback_id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_feedback_chat_group_id ON chat_feedback(chat_group_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_rating ON chat_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_created_at ON chat_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_group_resolved_at ON chat_group(resolved_at);

-- Comments for documentation
COMMENT ON TABLE chat_feedback IS 'Stores client feedback and ratings for completed chat sessions';
COMMENT ON COLUMN chat_feedback.rating IS 'Client rating from 1-5 stars';
COMMENT ON COLUMN chat_feedback.feedback_text IS 'Optional text feedback from client';
COMMENT ON COLUMN chat_feedback.chat_duration_seconds IS 'Duration of chat session in seconds';
COMMENT ON COLUMN chat_feedback.message_count IS 'Total number of messages in the chat session';
COMMENT ON COLUMN chat_group.resolved_at IS 'Timestamp when chat was marked as resolved';
COMMENT ON COLUMN chat_group.feedback_id IS 'Reference to associated feedback record';