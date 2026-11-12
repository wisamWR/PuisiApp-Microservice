-- User untuk outbox-relay (Debezium, T0.3). Hanya hak REPLICATION + LOGIN.
-- Hak CONNECT dan replication slot diberikan per database di skrip layanan
-- yang punya tabel outbox (lihat 01-example.sql). SELECT pada tabel outbox
-- diberikan oleh migrasi standar outbox di libs/node.

\getenv debezium_db_pass DEBEZIUM_DB_PASS

CREATE ROLE debezium LOGIN REPLICATION PASSWORD :'debezium_db_pass';
