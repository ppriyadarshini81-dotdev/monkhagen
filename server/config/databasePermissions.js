// Read-only production guard: never alter Neon roles or privileges implicitly.
async function assertProductionDatabaseRole(database, environment = process.env) {
  if (environment.NODE_ENV !== 'production') return;
  const { rows } = await database.query(`SELECT
    EXISTS (SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER')
      AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls)) AS dangerous_role,
    has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
    EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'public'
      AND pg_has_role(current_user, n.nspowner, 'MEMBER')) AS schema_owner,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S')
      AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS object_owner`);
  const permissions = rows[0];
  if (!permissions || Object.values(permissions).some(Boolean)) {
    throw Object.assign(new Error('Production DATABASE_URL must use a restricted application role. Run migrations with separate owner credentials.'),
      { code: 'DB_ROLE_UNSAFE' });
  }
}
module.exports = { assertProductionDatabaseRole };
