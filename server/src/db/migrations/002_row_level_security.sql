-- Supabase publishes every table in the public schema through an
-- auto-generated REST API that anyone holding the project's anon key can call.
-- Without row level security that would expose password hashes, refresh token
-- hashes and every message.
--
-- RLS is enabled with no policies, so that API can read and write nothing.
-- The Node server is unaffected: it connects as the role that owns the tables,
-- and table owners bypass RLS. On plain Postgres this is a harmless no-op.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
