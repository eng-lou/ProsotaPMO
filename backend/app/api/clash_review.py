import base64
import gzip
import zlib
import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.project import Project
from app.models.clash_test import ClashTest
from app.models.clash_result import ClashResult
from app.models.clash_run import ClashRun, ClashReport
from app.schemas.clash_review import RunRequest, ReportRequest, ReportComment, EmailRequest, IssueRequest
from app.services.clash_test import replace_results

router = APIRouter(prefix="/clash-review", tags=["clash-review"])
public_router = APIRouter(prefix="/public/clash-reports", tags=["shared-clashes"])


from app.services.clash_access import owned_test


def limited_payload(value):
    if len(json.dumps(value, separators=(",", ":")).encode()) > 3_000_000:
        raise HTTPException(413, "Clash snapshot exceeds 3 MB. Use smaller collections or share fewer clashes.")


@router.post("/{test_id}/runs", status_code=201)
async def save_run(test_id: uuid.UUID, data: RunRequest, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    test = await owned_test(db, test_id, user, lock=True)
    if not data.complete or data.expected != data.resolved + data.excluded:
        raise HTTPException(422, "Incomplete run: previous results have been preserved")
    if data.scope == "all" and data.excluded:
        raise HTTPException(422, "An all-elements run cannot exclude elements")
    if test.updated_at.isoformat() != data.test_updated_at.replace("Z", "+00:00"):
        raise HTTPException(409, "The test changed while running. Review its settings and run again.")
    from app.models.collection_member import CollectionMember
    members = (await db.execute(select(CollectionMember).where(CollectionMember.collection_id.in_([test.group_a_collection_id, test.group_b_collection_id])))).scalars().all()
    expected = len(members) * (2 if test.group_a_collection_id == test.group_b_collection_id else 1)
    if expected != data.expected or {m.id for m in members} != set(data.member_ids):
        raise HTTPException(409, "Collection membership changed while running. Run again.")
    def original_ref(value):
        if value.startswith("@model:"):
            try:
                return json.loads(value[7:])[1]
            except (ValueError, IndexError, TypeError):
                raise HTTPException(422, "Invalid model-qualified element")
        return value
    original_keys = {f"{k.split(':', 1)[0]}:{original_ref(k.split(':', 1)[1])}" for k in data.checked_keys if ':' in k}
    available_keys = {f"{m.source_kind}:{m.element_ref}" for m in members}
    if not original_keys.issubset(available_keys) or (data.scope == "all" and original_keys != available_keys):
        raise HTTPException(422, "Run coverage does not match the collections")
    keys_in_pairs = {f"{p.element_a_source_kind}:{p.element_a_ref}" for p in data.pairs} | {f"{p.element_b_source_kind}:{p.element_b_ref}" for p in data.pairs}
    if not keys_in_pairs.issubset(data.checked_keys):
        raise HTTPException(422, "Clash results include untested elements")
    payload = data.model_dump(mode="json")
    limited_payload(payload)
    keys = {f"{p.element_a_source_kind}:{p.element_a_ref}" for p in data.pairs} | {f"{p.element_b_source_kind}:{p.element_b_ref}" for p in data.pairs}
    geometry_items = data.geometry
    if data.geometry_z:
        try:
            raw = base64.b64decode(data.geometry_z, validate=True)
            decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
            unpacked = decoder.decompress(raw, 50_000_001)
            if len(unpacked) > 50_000_000 or not decoder.eof or decoder.unused_data:
                raise ValueError("Geometry exceeds 50 MB or is incomplete")
            from pydantic import TypeAdapter
            from app.schemas.clash_review import ElementGeometry
            geometry_items = TypeAdapter(list[ElementGeometry]).validate_json(unpacked)
        except (ValueError, zlib.error) as e:
            raise HTTPException(422, "Invalid or oversized geometry snapshot") from e
    geometry = {e.key: e.model_dump() for e in geometry_items}
    if len(geometry) != len(geometry_items):
        raise HTTPException(422, "Duplicate geometry element")
    if set(geometry) != keys:
        raise HTTPException(422, "Geometry must contain exactly the tested clash elements")
    response = await replace_results(db, test_id, data.pairs, commit=False, checked_keys=set(data.checked_keys))
    snapshot = {
        "name": test.name, "test_type": test.test_type, "tolerance_mm": test.tolerance_mm,
        "run_at": test.last_run_at.isoformat(), "scope": data.scope, "timeline_date": data.timeline_date,
        "expected": data.expected, "resolved": data.resolved, "excluded": data.excluded,
        "models": data.models, "warnings": data.warnings, "collection_a_id": str(test.group_a_collection_id), "collection_b_id": str(test.group_b_collection_id),
        "results": [r.model_dump(mode="json") for r in response.results if (r.element_a_ref, r.element_b_ref) in {(p.element_a_ref, p.element_b_ref) for p in data.pairs}],
        "metres_per_unit": data.metres_per_unit, "geometry_fingerprint": data.geometry_fingerprint,
        "geometry_z": base64.b64encode(gzip.compress(json.dumps(list(geometry.values()), separators=(",", ":")).encode())).decode(),
    }
    run = ClashRun(clash_test_id=test_id, snapshot=snapshot)
    db.add(run)
    await db.commit()
    return {"test": response, "run_id": str(run.id)}


@router.get("/{test_id}/runs")
async def list_runs(test_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_test(db, test_id, user)
    # Project only small run metadata; never load every historic geometry blob.
    summary = ClashRun.snapshot.op('-')('geometry_z').op('-')('results').label('summary')
    from sqlalchemy import func
    rows = (await db.execute(select(ClashRun.id, summary, func.jsonb_array_length(ClashRun.snapshot['results']).label('result_count')).where(ClashRun.clash_test_id == test_id).order_by(ClashRun.created_at.desc()).limit(50))).all()
    return [{"id": str(r.id), **r.summary, "result_count": r.result_count, "results": []} for r in rows]



@router.post("/{test_id}/reports", status_code=201)
async def share_report(test_id: uuid.UUID, data: ReportRequest, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_test(db, test_id, user)
    run = await db.get(ClashRun, data.run_id)
    if not run or run.clash_test_id != test_id:
        raise HTTPException(404, "Run not found")
    ids = {str(i) for i in data.result_ids}
    results = [r for r in run.snapshot["results"] if r["id"] in ids and r["status"] != "resolved"]
    if len(results) != len(ids):
        raise HTTPException(422, "Select clashes present in this run")
    # Share current review notes while freezing geometry and detection evidence from the run.
    current = (await db.execute(select(ClashResult).where(ClashResult.id.in_(data.result_ids), ClashResult.clash_test_id == test_id))).scalars().all()
    review = {str(r.id): r for r in current}
    results = [{**r, "status": review[r["id"]].status, "comment": review[r["id"]].comment} if r["id"] in review else r for r in results]
    results = [{k: v for k, v in r.items() if k not in ("review_history", "issue_id", "clash_test_id")} for r in results]
    keys = {f"{r['element_a_source_kind']}:{r['element_a_ref']}" for r in results} | {f"{r['element_b_source_kind']}:{r['element_b_ref']}" for r in results}
    snapshot = {k: v for k, v in run.snapshot.items() if k not in ("results", "geometry", "geometry_z", "models", "collection_a_id", "collection_b_id")}
    # The model inventory is deliberately omitted from external reports.
    snapshot["warnings"] = ["Open/non-manifold surfaces may not support containment detection. See the run geometry limitations."] if snapshot.get("warnings") else []
    run_geometry = json.loads(gzip.decompress(base64.b64decode(run.snapshot["geometry_z"])))
    selected_geometry = [g for g in run_geometry if g["key"] in keys]
    snapshot.update(results=results, geometry=selected_geometry)
    if {g["key"] for g in snapshot["geometry"]} != keys:
        raise HTTPException(422, "This run has no complete geometry snapshot. Run the test again.")
    snapshot["viewpoints"] = {str(k): v.model_dump() for k, v in data.viewpoints.items() if str(k) in ids}
    snapshot.pop("geometry")
    snapshot["geometry_z"] = base64.b64encode(gzip.compress(json.dumps(selected_geometry, separators=(",", ":")).encode())).decode()
    token = secrets.token_urlsafe(32)
    report = ClashReport(clash_test_id=test_id, token_hash=hashlib.sha256(token.encode()).hexdigest(), snapshot=snapshot,
                         expires_at=datetime.now(timezone.utc) + timedelta(days=data.expires_days), allow_comments=data.allow_comments)
    db.add(report)
    await db.commit()
    return {"id": str(report.id), "token": token, "expires_at": report.expires_at}


@router.get("/{test_id}/reports")
async def reports(test_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_test(db, test_id, user)
    rows = (await db.execute(select(ClashReport).where(ClashReport.clash_test_id == test_id).order_by(ClashReport.created_at.desc()))).scalars()
    return [{"id": r.id, "created_at": r.created_at, "expires_at": r.expires_at, "revoked": r.revoked, "comments": r.comments} for r in rows]


@router.delete("/{test_id}/reports/{report_id}", status_code=204)
async def revoke(test_id: uuid.UUID, report_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_test(db, test_id, user)
    report = await db.get(ClashReport, report_id)
    if not report or report.clash_test_id != test_id:
        raise HTTPException(404, "Report not found")
    report.revoked = True
    await db.commit()
    return Response(status_code=204)


async def available_report(db, token, lock=False):
    if len(token) > 100:
        raise HTTPException(404, "Report unavailable")
    q = select(ClashReport).where(ClashReport.token_hash == hashlib.sha256(token.encode()).hexdigest())
    if lock:
        q = q.with_for_update()
    report = (await db.execute(q)).scalar_one_or_none()
    if not report or report.revoked or report.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(404, "This report has expired or is no longer available")
    return report


@public_router.get("/{token}")
async def read_report(token: str, response: Response, db: AsyncSession = Depends(get_db)):
    report = await available_report(db, token)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return {"snapshot": report.snapshot, "expires_at": report.expires_at, "allow_comments": report.allow_comments, "comments": report.comments}


@public_router.post("/{token}/comments", status_code=201)
async def comment(token: str, data: ReportComment, db: AsyncSession = Depends(get_db)):
    report = await available_report(db, token, lock=True)
    if not report.allow_comments:
        raise HTTPException(403, "This report is read-only")
    if str(data.result_id) not in {r["id"] for r in report.snapshot["results"]}:
        raise HTTPException(422, "Clash is not part of this report")
    if len(report.comments) >= 200:
        raise HTTPException(429, "Report comment limit reached")
    report.comments = [*report.comments, {**data.model_dump(mode="json"), "created_at": datetime.now(timezone.utc).isoformat()}]
    await db.commit()
    return {"comments": report.comments}


@router.post("/{test_id}/reports/{report_id}/email")
async def email_report(test_id: uuid.UUID, report_id: uuid.UUID, data: EmailRequest, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_test(db, test_id, user)
    report = await available_report(db, data.token)
    if report.id != report_id or report.clash_test_id != test_id:
        raise HTTPException(404, "Report not found")
    from app.core.config import settings
    if not settings.smtp_host or not settings.smtp_from or not settings.public_app_url:
        raise HTTPException(503, "Email delivery is not configured. Use Copy link or Open email app.")
    from email.message import EmailMessage
    from starlette.concurrency import run_in_threadpool
    import smtplib
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = data.recipient
    message["Subject"] = "Prosota clash report"
    url = settings.public_app_url.rstrip("/") + "/clash-report#" + data.token
    message.set_content(f"You have been invited to review a clash report.\n\n{url}\n\nExpires: {report.expires_at.isoformat()}\n")
    def send():
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    try:
        await run_in_threadpool(send)
    except (OSError, smtplib.SMTPException):
        raise HTTPException(502, "Email could not be sent. Copy the link or retry.")
    return {"sent": True}


@router.post("/{test_id}/results/{result_id}/issue", status_code=201)
async def create_issue(test_id: uuid.UUID, result_id: uuid.UUID, data: IssueRequest, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    test = await owned_test(db, test_id, user, lock=True)
    result = await db.get(ClashResult, result_id)
    from app.models.period import Period
    period = await db.get(Period, data.period_id)
    if not result or result.clash_test_id != test_id or not period or period.project_id != test.project_id:
        raise HTTPException(404, "Clash or period not found")
    from app.models.icd_item import IcdItem
    from app.services.reference_codes import next_code
    from app.services.icd_item import _require_live_period
    await _require_live_period(db, data.period_id)
    if result.issue_id:
        item = await db.get(IcdItem, result.issue_id)
        return {"id": item.id, "code": item.code}
    run = (await db.execute(select(ClashRun).where(ClashRun.clash_test_id == test_id).order_by(ClashRun.created_at.desc()).limit(1))).scalar_one_or_none()
    code = await next_code(db, IcdItem, "ISS", test.project_id, extra_filter=IcdItem.item_type == "issue")
    item = IcdItem(project_id=test.project_id, period_id=data.period_id, code=code, item_type="issue", status="open",
        title=f"Clash: {result.element_a_label} / {result.element_b_label}"[:200],
        description=f"Clash test: {test.name}\nClash ID: {result.id}\nSaved run: {run.id if run else 'legacy'}\nA: {result.element_a_ref}\nB: {result.element_b_ref}\nReview: /4d?clash_test={test.id}&clash_result={result.id}\n{result.comment or ''}",
        owner=data.owner or None, due_date=data.due_date, severity="medium")
    db.add(item)
    await db.flush()
    result.issue_id = item.id
    await db.commit()
    return {"id": item.id, "code": item.code}


@router.get("/{test_id}/runs/{run_id}")
async def get_run(test_id: uuid.UUID, run_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_test(db, test_id, user)
    run = await db.get(ClashRun, run_id)
    if not run or run.clash_test_id != test_id:
        raise HTTPException(404, "Run not found")
    return {"id": str(run.id), **run.snapshot}


@router.get("/{test_id}/results/{result_id}/latest-run")
async def latest_result_run(test_id: uuid.UUID, result_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_test(db, test_id, user)
    run = (await db.execute(select(ClashRun).where(ClashRun.clash_test_id == test_id, ClashRun.snapshot['results'].contains([{"id": str(result_id)}])).order_by(ClashRun.created_at.desc()).limit(1))).scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run this test again to capture a review viewport")
    return {"id": str(run.id), **run.snapshot}
