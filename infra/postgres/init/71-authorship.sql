\getenv authorship_db_pass AUTHORSHIP_DB_PASS
\getenv authorship_query_db_pass AUTHORSHIP_QUERY_DB_PASS

CREATE ROLE authorship LOGIN PASSWORD :'authorship_db_pass';
CREATE ROLE authorship_query LOGIN PASSWORD :'authorship_query_db_pass';

CREATE DATABASE authorship_db OWNER authorship;
REVOKE ALL ON DATABASE authorship_db FROM PUBLIC;
GRANT CONNECT ON DATABASE authorship_db TO authorship;
GRANT CONNECT ON DATABASE authorship_db TO authorship_query;

\connect authorship_db

GRANT USAGE, CREATE ON SCHEMA public TO authorship;
GRANT USAGE ON SCHEMA public TO authorship_query;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authorship;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authorship_query;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authorship;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authorship_query;

ALTER DEFAULT PRIVILEGES FOR ROLE authorship IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authorship_query;
ALTER DEFAULT PRIVILEGES FOR ROLE authorship IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authorship_query;
