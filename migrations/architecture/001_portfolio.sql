CREATE SCHEMA IF NOT EXISTS experiments_architecture;
REVOKE ALL ON SCHEMA experiments_architecture FROM PUBLIC;

CREATE TABLE experiments_architecture.catalog_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO experiments_architecture.catalog_revision DEFAULT VALUES;

CREATE TABLE experiments_architecture.applications (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description text NOT NULL,
  owner text,
  lifecycle text NOT NULL CHECK (lifecycle IN ('unknown','proposed','active','retired')),
  repository text,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE experiments_architecture.components (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES experiments_architecture.applications(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('web','api','worker','datastore','integration','library')),
  responsibility text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, application_id), UNIQUE (application_id, name)
);
CREATE TABLE experiments_architecture.interfaces (
  id text PRIMARY KEY,
  provider_component_id text NOT NULL REFERENCES experiments_architecture.components(id),
  name text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('http','event','file','sql','library')),
  contract_version text NOT NULL,
  reference text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_component_id, name, contract_version)
);
CREATE TABLE experiments_architecture.dependencies (
  id text PRIMARY KEY,
  consumer_component_id text NOT NULL REFERENCES experiments_architecture.components(id),
  interface_id text NOT NULL REFERENCES experiments_architecture.interfaces(id),
  purpose text NOT NULL,
  criticality text NOT NULL CHECK (criticality IN ('unknown','low','medium','high')),
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_component_id, interface_id)
);
CREATE TABLE experiments_architecture.data_assets (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES experiments_architecture.applications(id),
  authority_component_id text NOT NULL,
  name text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('unknown','public','internal','confidential','restricted')),
  description text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (authority_component_id, application_id) REFERENCES experiments_architecture.components(id, application_id),
  UNIQUE (application_id, name)
);
CREATE TABLE experiments_architecture.standards (
  id text PRIMARY KEY,
  application_id text REFERENCES experiments_architecture.applications(id),
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('architecture','interface','security','data','operations')),
  rule text NOT NULL,
  owner text,
  status text NOT NULL CHECK (status IN ('proposed','documented','retired')),
  policy_reference text,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE experiments_architecture.evidence (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES experiments_architecture.applications(id),
  kind text NOT NULL CHECK (kind IN ('document','code','test','deployment','runtime')),
  location text NOT NULL,
  source_commit text CHECK (source_commit IS NULL OR source_commit ~ '^[a-f0-9]{40}$'),
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  summary text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, application_id)
);
CREATE TABLE experiments_architecture.assessments (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES experiments_architecture.applications(id),
  standard_id text NOT NULL REFERENCES experiments_architecture.standards(id),
  standard_version integer NOT NULL CHECK (standard_version > 0),
  evidence_id text,
  outcome text NOT NULL CHECK (outcome IN ('passed','failed','inconclusive')),
  notes text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (evidence_id, application_id) REFERENCES experiments_architecture.evidence(id, application_id),
  CHECK (outcome = 'inconclusive' OR evidence_id IS NOT NULL)
);
CREATE TABLE experiments_architecture.deployments (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES experiments_architecture.applications(id),
  component_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development','staging','production')),
  source_commit text NOT NULL CHECK (source_commit ~ '^[a-f0-9]{40}$'),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (component_id, application_id) REFERENCES experiments_architecture.components(id, application_id),
  FOREIGN KEY (evidence_id, application_id) REFERENCES experiments_architecture.evidence(id, application_id)
);
CREATE TABLE experiments_architecture.source_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_path text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_path, content_sha256)
);
CREATE TABLE experiments_architecture.changes (
  revision integer PRIMARY KEY CHECK (revision > 0),
  entity text NOT NULL,
  record_id text NOT NULL,
  change_note text NOT NULL CHECK (length(trim(change_note)) BETWEEN 1 AND 2000),
  snapshot jsonb NOT NULL,
  actor text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX components_application_idx ON experiments_architecture.components(application_id);
CREATE INDEX interfaces_provider_idx ON experiments_architecture.interfaces(provider_component_id);
CREATE INDEX dependencies_interface_idx ON experiments_architecture.dependencies(interface_id);
CREATE INDEX standards_application_idx ON experiments_architecture.standards(application_id);
CREATE INDEX evidence_application_idx ON experiments_architecture.evidence(application_id, observed_at DESC);
CREATE INDEX assessments_latest_idx ON experiments_architecture.assessments(application_id, standard_id, updated_at DESC, id);
CREATE INDEX deployments_component_idx ON experiments_architecture.deployments(component_id, environment, observed_at DESC);
CREATE INDEX changes_record_idx ON experiments_architecture.changes(entity, record_id, revision DESC);

CREATE FUNCTION experiments_architecture.validate_observation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, experiments_architecture AS $$
BEGIN
  IF TG_TABLE_NAME = 'assessments' THEN
    IF NOT EXISTS (SELECT 1 FROM experiments_architecture.standards s
      WHERE s.id=NEW.standard_id AND s.version=NEW.standard_version AND s.status <> 'retired'
      AND (s.application_id IS NULL OR s.application_id=NEW.application_id)) THEN
      RAISE EXCEPTION 'Assessment requires current applicable standard' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'deployments' THEN
    IF NOT EXISTS (SELECT 1 FROM experiments_architecture.evidence e
      WHERE e.id=NEW.evidence_id AND e.application_id=NEW.application_id
      AND e.kind='deployment' AND e.source_commit=NEW.source_commit) THEN
      RAISE EXCEPTION 'Deployment requires matching evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_assessment BEFORE INSERT ON experiments_architecture.assessments
FOR EACH ROW EXECUTE FUNCTION experiments_architecture.validate_observation();
CREATE TRIGGER validate_deployment BEFORE INSERT ON experiments_architecture.deployments
FOR EACH ROW EXECUTE FUNCTION experiments_architecture.validate_observation();

CREATE VIEW experiments_architecture.dependency_map AS
SELECT d.id, consumer.application_id AS consumer_application_id,
       consumer.id AS consumer_component_id, provider.application_id AS provider_application_id,
       provider.id AS provider_component_id, i.id AS interface_id,
       i.protocol, i.contract_version, d.criticality, d.purpose
FROM experiments_architecture.dependencies d
JOIN experiments_architecture.components consumer ON consumer.id=d.consumer_component_id
JOIN experiments_architecture.interfaces i ON i.id=d.interface_id
JOIN experiments_architecture.components provider ON provider.id=i.provider_component_id;

CREATE VIEW experiments_architecture.coverage AS
SELECT a.id AS application_id, s.id AS standard_id, s.version AS standard_version,
       latest.id AS assessment_id, latest.outcome, latest.evidence_id,
       CASE WHEN latest.id IS NULL THEN 'not_assessed'
            WHEN latest.standard_version <> s.version THEN 'stale'
            ELSE latest.outcome END AS state
FROM experiments_architecture.applications a
JOIN experiments_architecture.standards s ON (s.application_id IS NULL OR s.application_id=a.id) AND s.status <> 'retired'
LEFT JOIN LATERAL (
  SELECT x.* FROM experiments_architecture.assessments x
  WHERE x.application_id=a.id AND x.standard_id=s.id
  ORDER BY x.updated_at DESC, x.id DESC LIMIT 1
) latest ON true;

REVOKE ALL ON ALL TABLES IN SCHEMA experiments_architecture FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA experiments_architecture FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA experiments_architecture FROM PUBLIC;
