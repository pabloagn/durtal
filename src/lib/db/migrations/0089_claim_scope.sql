ALTER TABLE "enrichment_claims" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD COLUMN "assessment" jsonb;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claim_scope_pair" CHECK (("enrichment_claims"."scope" is null) = ("enrichment_claims"."assessment" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_enrichment_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d enrichment_dimensions%ROWTYPE; t enrichment_terms%ROWTYPE; values_ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.edition_id, NEW.dimension_id, NEW.term_id, NEW.number_value, NEW.text_value, NEW.method, NEW.run_id, NEW.vocabulary_version, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.edition_id, OLD.dimension_id, OLD.term_id, OLD.number_value, OLD.text_value, OLD.method, OLD.run_id, OLD.vocabulary_version, OLD.created_at)
      OR (NEW.work_id IS DISTINCT FROM OLD.work_id AND NOT harmonization_allows_move('works', OLD.work_id, NEW.work_id))
      OR (NEW.person_id IS DISTINCT FROM OLD.person_id AND NOT harmonization_allows_move('authors', OLD.person_id, NEW.person_id))
      OR (NEW.place_id IS DISTINCT FROM OLD.place_id AND NOT harmonization_allows_move('places', OLD.place_id, NEW.place_id)) THEN
      PERFORM enrichment_rule_error('A claim''s value never changes; propose a new claim', 'enrichment_claim_identity');
    END IF;
    IF OLD.status = 'rejected' AND (NEW.status, NEW.decided_by, NEW.decision_reason, NEW.decided_at) IS DISTINCT FROM (OLD.status, OLD.decided_by, OLD.decision_reason, OLD.decided_at) THEN
      PERFORM enrichment_rule_error('A rejected claim stays rejected', 'enrichment_claim_decision');
    END IF;
    IF NEW.confidence IS DISTINCT FROM OLD.confidence AND NOT (OLD.status = 'proposed' AND NEW.status = 'proposed') THEN
      PERFORM enrichment_rule_error('A claim''s confidence changes only while it is proposed', 'enrichment_claim_decision');
    END IF;
    NEW.updated_at := now();
  END IF;
  SELECT * INTO STRICT d FROM enrichment_dimensions WHERE id = NEW.dimension_id;
  IF TG_OP = 'INSERT' THEN
    IF d.apply_target = 'none' THEN
      PERFORM enrichment_rule_error('A measurement is not a claim: nothing is applied for this dimension', 'enrichment_claim_dimension');
    END IF;
    IF NEW.vocabulary_version < d.introduced_in OR (d.retired_in IS NOT NULL AND NEW.vocabulary_version >= d.retired_in) THEN
      PERFORM enrichment_rule_error('The dimension is not current in this vocabulary version', 'enrichment_claim_dimension');
    END IF;
    values_ok := CASE d.value_kind
      WHEN 'term' THEN num_nonnulls(NEW.term_id) = 1 AND num_nonnulls(NEW.number_value, NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'terms' THEN num_nonnulls(NEW.term_id) = 1 AND num_nonnulls(NEW.number_value, NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'scale' THEN num_nonnulls(NEW.term_id, NEW.number_value) = 2 AND num_nonnulls(NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'number' THEN num_nonnulls(NEW.number_value) = 1 AND num_nonnulls(NEW.term_id, NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'text' THEN num_nonnulls(NEW.text_value) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'identifier' THEN num_nonnulls(NEW.text_value) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'place' THEN num_nonnulls(NEW.place_id) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.text_value, NEW.person_id) = 0
      WHEN 'person' THEN num_nonnulls(NEW.person_id) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.text_value, NEW.place_id) = 0
      ELSE false END;
    IF NOT values_ok THEN
      PERFORM enrichment_rule_error(format('A %s dimension takes a value of its own kind', d.value_kind), 'enrichment_claim_value');
    END IF;
    IF NEW.term_id IS NOT NULL THEN
      SELECT * INTO STRICT t FROM enrichment_terms WHERE id = NEW.term_id;
      IF t.dimension_id <> d.id THEN
        PERFORM enrichment_rule_error('The term belongs to another dimension', 'enrichment_claim_value');
      END IF;
      IF NEW.vocabulary_version < t.introduced_in OR (t.retired_in IS NOT NULL AND NEW.vocabulary_version >= t.retired_in) THEN
        PERFORM enrichment_rule_error('The term is not current in this vocabulary version', 'enrichment_claim_value');
      END IF;
      IF d.value_kind = 'scale' AND NEW.number_value <> t.scale_value THEN
        PERFORM enrichment_rule_error('A scale claim''s number is its anchor''s scale value', 'enrichment_claim_value');
      END IF;
    END IF;
  END IF;
  IF (NEW.scope IS NULL AND (d.entity_level = 'edition') <> (NEW.edition_id IS NOT NULL))
    OR (NEW.scope IS NOT NULL AND d.entity_level = 'edition' AND NEW.edition_id IS NULL) THEN
    PERFORM enrichment_rule_error('An edition is set exactly for an edition-level dimension', 'enrichment_claim_edition');
  END IF;
  IF NEW.edition_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.work_id IS DISTINCT FROM OLD.work_id)
    AND NOT EXISTS (SELECT 1 FROM editions WHERE id = NEW.edition_id AND work_id = NEW.work_id) THEN
    PERFORM enrichment_rule_error('The edition belongs to another book', 'enrichment_claim_edition');
  END IF;
  IF NEW.rule_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.rule_id IS DISTINCT FROM OLD.rule_id)
    AND NOT EXISTS (SELECT 1 FROM enrichment_auto_accept_rules WHERE id = NEW.rule_id AND dimension_id = NEW.dimension_id) THEN
    PERFORM enrichment_rule_error('The rule belongs to another dimension', 'enrichment_claim_decision');
  END IF;
  IF NEW.superseded_by_claim_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.superseded_by_claim_id IS DISTINCT FROM OLD.superseded_by_claim_id)
    AND NOT EXISTS (SELECT 1 FROM enrichment_claims WHERE id = NEW.superseded_by_claim_id AND dimension_id = NEW.dimension_id) THEN
    PERFORM enrichment_rule_error('A claim is superseded by a claim of its own dimension', 'enrichment_claim_decision');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Scope is part of identity, even for an unresolved source-local observation.
DROP INDEX enrichment_claim_open_unique;
--> statement-breakpoint
CREATE FUNCTION enrichment_scope_hash(jsonb) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT
 AS $$ SELECT sha256(convert_to($1::text, 'UTF8')) $$;
--> statement-breakpoint
CREATE UNIQUE INDEX enrichment_claim_open_unique ON enrichment_claims
 (work_id, edition_id, dimension_id, term_id, number_value, text_value, place_id, person_id, enrichment_scope_hash(scope))
 NULLS NOT DISTINCT WHERE status = 'proposed';
--> statement-breakpoint
CREATE FUNCTION guard_enrichment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s jsonb := NEW.scope; a jsonb := NEW.assessment; lang jsonb; target text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.scope, NEW.assessment) IS DISTINCT FROM (OLD.scope, OLD.assessment) THEN
    PERFORM enrichment_rule_error('Scope and assessment never change; propose a new assertion', 'enrichment_scope_identity');
  END IF;
  IF NEW.superseded_by_claim_id IS NOT NULL AND EXISTS (SELECT 1 FROM enrichment_claims c WHERE c.id = NEW.superseded_by_claim_id
      AND (c.scope, c.edition_id) IS DISTINCT FROM (NEW.scope, NEW.edition_id)) THEN
    PERFORM enrichment_rule_error('Only compatible scoped assertions may supersede each other', 'enrichment_scope_identity');
  END IF;
  IF s IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(s) <> 'object' OR length(s::text) > 4096 OR s->>'version' IS DISTINCT FROM '1'
    OR NOT (s ?& ARRAY['version','kind','identityKey','languages','textKind','componentKey','componentKind','unresolvedSourceId','relation'])
    OR (s - ARRAY['version','kind','identityKey','languages','textKind','componentKey','componentKind','unresolvedSourceId','relation']) <> '{}'::jsonb
    OR jsonb_typeof(s->'version') <> 'number'
    OR coalesce(s->>'kind','') NOT IN ('work','text','component','edition')
    OR coalesce(s->>'textKind','') NOT IN ('original','translation','revision','abridgment','parallel','unknown')
    OR coalesce(s->>'relation','') NOT IN ('classification','about','thematizes','mentions','primary_setting','secondary_setting','frame_setting','remembered_setting','embedded_setting')
    OR jsonb_typeof(s->'languages') <> 'array' THEN
    PERFORM enrichment_rule_error('Invalid versioned assertion scope', 'enrichment_scope_shape');
  END IF;
  IF jsonb_array_length(s->'languages') > 10 THEN
    PERFORM enrichment_rule_error('Too many text languages', 'enrichment_scope_shape');
  END IF;
  FOR lang IN SELECT value FROM jsonb_array_elements(s->'languages') LOOP
    IF jsonb_typeof(lang) <> 'string' OR (lang #>> '{}') !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' THEN
      PERFORM enrichment_rule_error('Invalid text language', 'enrichment_scope_shape');
    END IF;
  END LOOP;
  IF s->'languages' <> (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM (SELECT DISTINCT value v FROM jsonb_array_elements(s->'languages')) q) THEN
    PERFORM enrichment_rule_error('Text languages must be unique and sorted', 'enrichment_scope_shape');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(s) e WHERE e.key IN ('identityKey','componentKey') AND
      (jsonb_typeof(e.value) NOT IN ('null','string') OR (jsonb_typeof(e.value) = 'string' AND (length(e.value #>> '{}') NOT BETWEEN 1 AND 500 OR btrim(e.value #>> '{}') <> e.value #>> '{}'))))
    OR (s->>'unresolvedSourceId' IS NOT NULL AND s->>'unresolvedSourceId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    PERFORM enrichment_rule_error('Invalid scoped identity key', 'enrichment_scope_shape');
  END IF;
  IF (s->>'kind' <> 'component' AND (s->>'componentKey' IS NOT NULL OR s->>'componentKind' IS NOT NULL))
    OR (s->>'kind' = 'component' AND coalesce(s->>'componentKind','') NOT IN ('independent_work','integral_part','augmenting_work','parallel_text'))
    OR (s->>'kind' = 'edition' AND (NEW.edition_id IS NULL OR s->>'identityKey' IS NOT NULL OR s->>'unresolvedSourceId' IS NOT NULL))
    OR (s->>'kind' = 'work' AND (NEW.edition_id IS NOT NULL OR s->>'textKind' NOT IN ('original','unknown')))
    OR (s->>'kind' <> 'edition' AND s->>'unresolvedSourceId' IS NULL AND
        (s->>'identityKey' IS NULL OR (s->>'kind' <> 'work' AND jsonb_array_length(s->'languages') = 0)
         OR (s->>'kind' = 'component' AND s->>'componentKey' IS NULL))) THEN
    PERFORM enrichment_rule_error('Scope identity is unresolved or incompatible with its target', 'enrichment_scope_target');
  END IF;
  IF jsonb_typeof(a) <> 'object' OR length(a::text) > 4096
    OR NOT (a ?& ARRAY['knowledge','coverage','basis','justification'])
    OR (a - ARRAY['knowledge','coverage','basis','justification']) <> '{}'::jsonb
    OR coalesce(a->>'knowledge','') NOT IN ('present','established_absent','partially_assessed','disputed','not_applicable')
    OR coalesce(a->>'coverage','') NOT IN ('unassessed','partial','complete')
    OR a->>'coverage' = 'unassessed'
    OR coalesce(a->>'basis','') NOT IN ('local_evidence','critical_account','complete_reading')
    OR jsonb_typeof(a->'justification') <> 'string' OR length(btrim(a->>'justification')) NOT BETWEEN 1 AND 2000
    OR (a->>'knowledge' = 'established_absent' AND (a->>'coverage' <> 'complete' OR a->>'basis' <> 'complete_reading')) THEN
    PERFORM enrichment_rule_error('Invalid knowledge or coverage assessment', 'enrichment_scope_assessment');
  END IF;
  SELECT apply_target INTO target FROM enrichment_dimensions WHERE id = NEW.dimension_id;
  IF target IN ('work.original_title','work.original_language','work.original_year') AND s->>'kind' <> 'work' THEN
    PERFORM enrichment_rule_error('Original Work facts cannot come from a translation or publication scope', 'enrichment_scope_target');
  END IF;
  IF NEW.status = 'accepted' THEN
    PERFORM enrichment_rule_error('Scoped assertions await scope-aware review; catalogue application is disabled', 'enrichment_scope_application');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_scope_guard BEFORE INSERT OR UPDATE ON enrichment_claims FOR EACH ROW EXECUTE FUNCTION guard_enrichment_scope();
--> statement-breakpoint
CREATE FUNCTION check_enrichment_scope_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_key uuid;
BEGIN
  IF TG_TABLE_NAME = 'enrichment_claims' THEN claim_key := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN claim_key := OLD.claim_id;
  ELSE claim_key := NEW.claim_id; END IF;
  IF EXISTS (SELECT 1 FROM enrichment_claims c WHERE c.id = claim_key AND c.scope->>'unresolvedSourceId' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM claim_evidence e WHERE e.claim_id = c.id AND e.source_record_id::text = c.scope->>'unresolvedSourceId')) THEN
    PERFORM enrichment_rule_error('Unresolved scope must cite its source observation', 'enrichment_scope_evidence');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER enrichment_scope_evidence_claim AFTER INSERT OR UPDATE ON enrichment_claims
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_enrichment_scope_evidence();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER enrichment_scope_evidence_row AFTER INSERT OR UPDATE OR DELETE ON claim_evidence
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_enrichment_scope_evidence();
