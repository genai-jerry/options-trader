-- 005_family_members — let one user (the "owner") invite other emails to
-- share the same data tree. When a member logs in (via Google) we link
-- their newly-created users.id into family_members.member_user_id and the
-- auth middleware routes their data queries to the owner's user_id.
--
-- Constraints:
--   * member_email is unique across the table — a given email can be in
--     at most one family at a time. A second owner trying to invite the
--     same email gets a UNIQUE-constraint violation that the route turns
--     into a 409.
--   * member_user_id is unique once set — same user can't be a member of
--     two families. This also means a "user" is either a member of one
--     family or the owner of their own data tree (the default).
--   * ON DELETE CASCADE for owner: removing a user removes their family
--     invites. ON DELETE SET NULL for member_user_id: deleting a user
--     leaves the invite open (re-linkable on a future login of that
--     email).

CREATE TABLE family_members (
  member_email   TEXT    PRIMARY KEY,
  owner_user_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id TEXT    UNIQUE   REFERENCES users(id) ON DELETE SET NULL,
  invited_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  accepted_at    TEXT
);

CREATE INDEX idx_family_owner       ON family_members(owner_user_id);
CREATE INDEX idx_family_member_user ON family_members(member_user_id);
