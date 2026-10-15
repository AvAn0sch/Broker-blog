CREATE FUNCTION reject_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only record' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION reject_record_mutation();
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON domain_events FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();
--> statement-breakpoint
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON job_receipts FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_article_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.author_id IS DISTINCT FROM OLD.author_id
    OR (OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at)
    OR (OLD.status = 'deleted' AND NEW.status <> 'deleted')
    OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.state_version <> OLD.state_version + 1) THEN
    RAISE EXCEPTION 'article identity or version conflict' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER articles_guard BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION guard_article_identity();
--> statement-breakpoint
CREATE FUNCTION guard_draft_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.article_id IS DISTINCT FROM OLD.article_id OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'draft version must advance exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER drafts_guard BEFORE UPDATE ON article_drafts FOR EACH ROW EXECUTE FUNCTION guard_draft_version();
--> statement-breakpoint
CREATE FUNCTION guard_review_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status = 'pending' OR NEW.version <> OLD.version + 1
    OR ROW(NEW.article_id,NEW.source_draft_version,NEW.title,NEW.markdown,NEW.summary,NEW.submitted_by,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.article_id,OLD.source_draft_version,OLD.title,OLD.markdown,OLD.summary,OLD.submitted_by,OLD.created_at)
    OR NEW.decided_at IS NULL
    OR (NEW.status IN ('approved','rejected') AND (NEW.decision_by IS NULL OR length(btrim(coalesce(NEW.reason,''))) = 0)) THEN
    RAISE EXCEPTION 'immutable or concluded review' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reviews_guard BEFORE UPDATE ON review_requests FOR EACH ROW EXECUTE FUNCTION guard_review_snapshot();
--> statement-breakpoint
CREATE FUNCTION guard_review_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  snapshot_status text;
  snapshot_transaction text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'immutable snapshot reference' USING ERRCODE = '42501';
  END IF;
  SELECT status,xmin::text INTO snapshot_status,snapshot_transaction FROM review_requests WHERE id=NEW.review_id;
  IF snapshot_status IS DISTINCT FROM 'pending' OR snapshot_transaction IS DISTINCT FROM (txid_current() % 4294967296)::text THEN
    RAISE EXCEPTION 'snapshot references must be fixed in submission transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER review_tags_guard BEFORE INSERT OR UPDATE OR DELETE ON review_tags FOR EACH ROW EXECUTE FUNCTION guard_review_reference();
--> statement-breakpoint
CREATE TRIGGER review_media_guard BEFORE INSERT OR UPDATE OR DELETE ON review_media FOR EACH ROW EXECUTE FUNCTION guard_review_reference();
--> statement-breakpoint
CREATE FUNCTION guard_tag_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'tag slug is stable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tags_guard BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION guard_tag_slug();
