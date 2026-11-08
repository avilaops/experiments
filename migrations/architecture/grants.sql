-- Run with psql -v runtime_role=experiments_architecture_api -f grants.sql.
-- The role must exist, must not own the schema, and must not be a superuser.
-- Credentials are provisioned separately; this file creates no login/password.
BEGIN;
GRANT USAGE ON SCHEMA experiments_architecture TO :"runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA experiments_architecture TO :"runtime_role";
GRANT INSERT, UPDATE ON experiments_architecture.applications,
  experiments_architecture.components, experiments_architecture.interfaces,
  experiments_architecture.dependencies, experiments_architecture.data_assets,
  experiments_architecture.standards TO :"runtime_role";
GRANT UPDATE ON experiments_architecture.catalog_revision TO :"runtime_role";
GRANT INSERT ON experiments_architecture.evidence, experiments_architecture.assessments,
  experiments_architecture.deployments, experiments_architecture.changes TO :"runtime_role";
COMMIT;
