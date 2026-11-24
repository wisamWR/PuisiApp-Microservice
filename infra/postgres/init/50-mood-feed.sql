\getenv mood_feed_db_pass MOOD_FEED_DB_PASS

CREATE ROLE mood_feed LOGIN PASSWORD :'mood_feed_db_pass';
CREATE DATABASE mood_feed_db OWNER mood_feed;
REVOKE ALL ON DATABASE mood_feed_db FROM PUBLIC;
GRANT CONNECT ON DATABASE mood_feed_db TO mood_feed;
