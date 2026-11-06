-- 015_drop_posts_table.sql
-- Drop posts and comments tables from PostgreSQL
-- Posts and comments are completely sovereign on static JSON feeds (posts.json, feed.json, *.comments.json)

DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS posts CASCADE;

