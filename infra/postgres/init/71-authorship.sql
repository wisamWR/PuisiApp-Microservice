\getenv authorship_db_pass AUTHORSHIP_DB_PASS

CREATE ROLE authorship LOGIN PASSWORD :'authorship_db_pass';
CREATE DATABASE authorship_db OWNER authorship;
REVOKE ALL ON DATABASE authorship_db FROM PUBLIC;
GRANT CONNECT ON DATABASE authorship_db TO authorship;
