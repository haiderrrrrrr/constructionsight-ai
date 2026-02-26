"""
Business annotations for the Smart Query Assistant schema registry.

Contains ONLY semantic meanings — never column lists or data types.
Column lists + types are always read live from PostgreSQL via schema_registry.py.

Structure per table:
  "__table__"  → one-line description of what the table stores
  "__rules__"  → SQL-oriented business rules (WHERE clauses, join paths, etc.)
  <col_name>   → meaning / value dictionary for that specific column
"""

TABLE_ANNOTATIONS: dict[str, dict[str, str]] = {

    "users": {
        "__table__": "Platform user accounts — admins and project team members",
        "__rules__": (
            "Active accounts: WHERE is_active = TRUE AND is_approved = TRUE\n"
            "Admins: WHERE platform_role = 'admin'\n"
            "Pending approvals: WHERE is_approved = FALSE\n"
            "Locked accounts: WHERE locked_until > NOW()\n"
            "Note: project-level roles (PM, supervisor) are in project_memberships, NOT here"
        ),
        "is_active": "FALSE = account deactivated/suspended, cannot log in",
        "platform_role": "'admin' = platform administrator | 'user' = regular user (PM, supervisor, etc.)",
        "is_approved": "FALSE = account pending admin approval, cannot log in yet",
        "can_create_project": "TRUE = user has been granted permission to create projects",
        "failed_login_count": "number of consecutive failed login attempts (reset on success)",
        "locked_until": "NULL = not locked; non-NULL = account locked until this timestamp",
        "token_version": "incremented on logout/password change to invalidate all refresh tokens",
        "auth_provider": "'local' = email+password login | 'google' = OAuth login",
    },

    "projects": {
        "__table__": "Construction projects — the top-level entity that cameras, zones, and teams belong to",
        "__rules__": (
            "Live projects: WHERE status = 'active'\n"
            "Archived/inactive: WHERE status = 'archived'\n"
            "In-setup: WHERE status IN ('draft', 'setup_in_progress')"
        ),
        "status": (
            "'draft' = admin created shell, not started | "
            "'setup_in_progress' = PM accepted invite, filling in details | "
            "'active' = live project with cameras and analytics running | "
            "'completed' = project finished | "
            "'archived' = read-only, no more data collection"
        ),
        "location": "physical address or site name",
        "client_name": "the client/owner this project is built for",
        "site_id": "FK → sites.id (every project has exactly one site)",
    },

    "project_memberships": {
        "__table__": "Team members assigned to projects with their roles",
        "__rules__": (
            "Current team members: WHERE status = 'active'\n"
            "PMs on a project: WHERE project_role = 'project_manager' AND status = 'active'\n"
            "Join path to user names: JOIN users ON user_id = users.id"
        ),
        "project_role": (
            "'project_manager' = leads the project | "
            "'site_supervisor' = oversees daily on-site work | "
            "'safety_officer' = responsible for PPE and risk compliance | "
            "'data_analyst' = analyzes metrics and reports | "
            "'stakeholder' = read-only observer"
        ),
        "status": "'active' = currently on the team | 'removed' = was removed from team",
    },

    "project_invitations": {
        "__table__": "Email invitations sent to users to join projects",
        "__rules__": (
            "Outstanding invites: WHERE status = 'pending' AND expires_at > NOW()\n"
            "Expired: WHERE status = 'expired' OR (status = 'pending' AND expires_at < NOW())"
        ),
        "status": (
            "'pending' = invite sent, awaiting response | "
            "'accepted' = person accepted and joined | "
            "'expired' = invite link past 7-day expiry | "
            "'cancelled' = admin cancelled the invite"
        ),
        "role": "the role the invited person will have when they accept",
    },

    "sites": {
        "__table__": "Construction site records — one site per project, auto-managed",
        "__rules__": (
            "Each project has exactly one site. Join via projects.site_id = sites.id\n"
            "Sites are auto-created when a project is created and deleted when a project is deleted"
        ),
    },

    "cameras": {
        "__table__": "Camera registry — all cameras registered in the system with their ML inference status",
        "__rules__": (
            "Active cameras: WHERE registry_status = 'verified' AND worker_status = 'running'\n"
            "Offline/problematic: WHERE worker_status = 'error' OR registry_status = 'verify_failed'\n"
            "Cameras on a project: JOIN project_cameras ON cameras.id = project_cameras.camera_id"
        ),
        "registry_status": (
            "'draft' = registered but not tested | "
            "'verifying' = connection test in progress | "
            "'verified' = successfully connected and tested | "
            "'verify_failed' = connection test failed (check RTSP credentials) | "
            "'archived' = decommissioned"
        ),
        "worker_status": (
            "'idle' = camera registered but ML inference not running | "
            "'running' = camera actively doing AI inference (detecting PPE, workforce, etc.) | "
            "'error' = ML inference crashed or lost stream"
        ),
        "worker_error": "error message when worker_status = 'error'",
        "last_inference_at": "when the camera last successfully processed a frame",
        "onvif_supported": "TRUE = camera supports ONVIF PTZ control protocol",
        "ptz_supported": "TRUE = camera supports pan/tilt/zoom",
        "connection_type": "'rtsp' = RTSP stream | other = alternative protocol",
    },

    "camera_credentials": {
        "__table__": "Encrypted camera connection credentials — never SELECT the encrypted fields",
        "__rules__": (
            "rtsp_url_enc, username_enc, password_enc are ENCRYPTED — NEVER SELECT them.\n"
            "Only use updated_at to check when credentials were last changed."
        ),
        "selected_stream_profile": "stream profile selected during setup (e.g. 'main', 'sub')",
        "transport_preference": "'tcp' | 'udp' — preferred RTSP transport protocol",
    },

    "camera_verifications": {
        "__table__": "Results of camera connection tests — one row per verification attempt",
        "__rules__": (
            "Most recent verification per camera: ORDER BY started_at DESC LIMIT 1\n"
            "Failed cameras: WHERE result_status = 'failed'\n"
            "Cameras offline most often: COUNT(*) WHERE result_status = 'failed' GROUP BY camera_id"
        ),
        "result_status": "'success' = camera reachable and stream works | 'failed' = could not connect",
        "failure_reason": "human-readable reason when result_status = 'failed'",
        "fps_detected": "frames per second measured during verification",
        "latency_ms": "round-trip latency to camera in milliseconds",
    },

    "camera_health_logs": {
        "__table__": "Periodic camera health check logs — tracks connectivity and stream quality over time",
        "__rules__": (
            "Camera offline time: COUNT(*) WHERE health_status = 'offline' GROUP BY camera_id\n"
            "Recent health: ORDER BY checked_at DESC LIMIT 1 per camera\n"
            "Unhealthy: WHERE health_status IN ('degraded', 'offline', 'maintenance')"
        ),
        "health_status": (
            "'healthy' = camera online and streaming normally | "
            "'degraded' = online but slow/dropping frames | "
            "'offline' = camera not reachable | "
            "'maintenance' = manually taken offline for servicing"
        ),
        "latency_ms": "response latency in milliseconds — high value = degraded performance",
    },

    "project_cameras": {
        "__table__": "Bridge table linking cameras to projects and zones",
        "__rules__": (
            "Cameras in project X: WHERE project_id = X\n"
            "Cameras in zone Y: WHERE zone_id = Y\n"
            "Unzoned cameras: WHERE zone_id IS NULL"
        ),
        "zone_id": "NULL = camera assigned to project but not yet assigned to a zone",
    },

    "zones": {
        "__table__": "Physical zones within a construction site (e.g. 'North Wing', 'Loading Bay')",
        "__rules__": (
            "Join to project: zones.site_id → sites.id → projects.site_id\n"
            "Each zone can have multiple cameras assigned to it"
        ),
        "zone_type": (
            "optional classification: 'scaffold' | 'entry' | 'storage' | "
            "'work_area' | 'hazard' | 'exclusion' | NULL = no type assigned"
        ),
    },

    "camera_zone_polygons": {
        "__table__": "AI zone boundaries defined as polygons within a camera's view",
        "__rules__": (
            "Active zone boundaries: WHERE is_active = 1\n"
            "Do NOT parse 'points' geometry in SQL — only COUNT or filter on metadata columns"
        ),
        "points": "JSON array of {x,y} coordinates normalised to [0,1] — not parseable in SQL",
        "zone_category": "'exclusion' = nobody allowed | 'ppe_required' = full PPE mandatory",
        "is_active": "1 = polygon active for AI inference | 0 = soft-disabled",
    },

    "ppe_incidents": {
        "__table__": "PPE safety violation records — each row is one violation event detected by AI cameras",
        "__rules__": (
            "⚠ TIME COLUMN = started_at (NOT triggered_at — that column does not exist on this table)\n"
            "PPE violation = any row (each row IS a violation)\n"
            "Helmet violation: WHERE has_helmet = FALSE (or incident_type IN ('no_helmet','both_missing'))\n"
            "Vest violation: WHERE has_vest = FALSE (or incident_type IN ('no_vest','both_missing'))\n"
            "Open violations: WHERE status = 'open'\n"
            "Today's violations: WHERE DATE(started_at) = CURRENT_DATE\n"
            "Ongoing violations: WHERE ended_at IS NULL\n"
            "Zone with most violations: GROUP BY zone_name ORDER BY COUNT(*) DESC\n"
            "Compliance rate = (1 - COUNT(violations)/total_detections) * 100"
        ),
        "global_person_id": (
            "ReID-based cross-camera worker identity scoped per project — "
            "links the same physical worker across different cameras; NULL if ReID disabled"
        ),
        "track_id": "ByteTrack person tracking ID (same person across frames within one camera)",
        "has_helmet": "FALSE = worker detected WITHOUT helmet = PPE violation. TRUE = helmet present.",
        "has_vest": "FALSE = worker detected WITHOUT safety vest = PPE violation. TRUE = vest present.",
        "incident_type": (
            "'no_helmet' = missing helmet only | "
            "'no_vest' = missing vest only | "
            "'both_missing' = neither helmet nor vest detected"
        ),
        "severity": (
            "'low' = brief/borderline exposure | "
            "'medium' = sustained violation | "
            "'high' = repeated or prolonged violation requiring escalation"
        ),
        "status": (
            "'open' = unaddressed, still active | "
            "'acknowledged' = seen by supervisor | "
            "'resolved' = corrective action taken"
        ),
        "started_at": "when the violation was FIRST detected by AI",
        "ended_at": "NULL = violation is still ongoing right now",
        "frame_confidence": "AI detection confidence score (0.0-1.0) at the triggering frame",
        "zone_name": "denormalized zone name — use this column for GROUP BY zone (faster than joining zones table)",
    },

    "workforce_snapshots": {
        "__table__": "Periodic workforce headcount snapshots per zone — taken every ~60 seconds",
        "__rules__": (
            "Idle workers: idle_count (workers standing still >30s)\n"
            "Active workers: active_count\n"
            "Utilization %: utilization_score * 100\n"
            "Latest snapshot per zone: ORDER BY recorded_at DESC, take most recent row per zone_name\n"
            "Average utilization today: AVG(utilization_score) WHERE DATE(recorded_at) = CURRENT_DATE\n"
            "Overcrowded zones: WHERE zone_status = 'OVERCROWDED'\n"
            "Peak workforce time: MAX(worker_count) GROUP BY DATE_TRUNC('hour', recorded_at)"
        ),
        "worker_count": "TOTAL workers detected in camera frame at this moment",
        "active_count": "workers classified as MOVING / performing tasks",
        "idle_count": "workers detected but NOT moving for >30 seconds (standing still, waiting)",
        "utilization_score": "active_count / worker_count ratio 0.0 (all idle) to 1.0 (all active) — multiply by 100 for %",
        "zone_status": (
            "'BALANCED' = worker count within configured min/max thresholds | "
            "'OVERCROWDED' = too many workers (above max threshold) | "
            "'UNDERSTAFFED' = too few workers (below min threshold)"
        ),
        "congestion_flag": "TRUE = zone is dangerously crowded",
        "avg_dwell_seconds": "average time workers have been in this zone without leaving",
        "trigger": "'interval' = scheduled snapshot | 'transition' = triggered by state change",
        "zone_name": "denormalized zone name — use for GROUP BY zone",
    },

    "activity_snapshots": {
        "__table__": "Periodic zone productivity snapshots — activity score, motion metrics, idle tracking",
        "__rules__": (
            "Productivity score: activity_score (0-100 scale)\n"
            "Inactive zones: WHERE zone_state = 'IDLE'\n"
            "Idle time: idle_minutes_today\n"
            "How long zone was active today: active_minutes_today\n"
            "Low productivity: WHERE activity_score < 40\n"
            "High productivity: WHERE activity_score >= 75\n"
            "Use most recent snapshot per zone for current state"
        ),
        "zone_state": (
            "'ACTIVE' = majority of workers moving and productive | "
            "'IDLE' = majority stationary, little work happening | "
            "'LOW_ACTIVITY' = some movement but below expected productivity | "
            "'ALERTED' = alert has been fired for this zone"
        ),
        "moving_count": "workers in active motion (walking, lifting, operating equipment)",
        "stationary_count": "workers not moving but still present",
        "idle_count": "workers idle for extended period",
        "motion_intensity_score": "raw motion magnitude score 0-100 (optical flow based)",
        "activity_score": "0-100 final productivity score. 0 = completely idle, 100 = full productivity",
        "active_minutes_today": "cumulative minutes zone was in ACTIVE state today",
        "idle_minutes_today": "cumulative minutes zone was in IDLE state today",
        "idle_duration_seconds": "current continuous idle streak duration in seconds",
        "longest_idle_seconds": "longest idle period recorded this session",
    },

    "workforce_alerts": {
        "__table__": "Alerts fired when workforce counts cross staffing thresholds",
        "__rules__": (
            "Active alerts: WHERE status = 'open'\n"
            "High severity open alerts: WHERE severity = 'high' AND status = 'open'\n"
            "Unacknowledged: WHERE acknowledged = FALSE\n"
            "Alert response time: acknowledged_at - triggered_at"
        ),
        "alert_type": (
            "'understaffed' = too few workers in zone | "
            "'idle_ratio_high' = too many idle workers | "
            "'sudden_drop' = worker count dropped sharply | "
            "'overload' = too many workers / congestion"
        ),
        "severity": "'low' | 'medium' | 'high'",
        "status": "'open' = unresolved | 'acknowledged' = seen | 'resolved' = handled",
        "acknowledged": "FALSE = nobody has seen this alert yet | TRUE = someone acknowledged it",
        "zone_name": "denormalized zone name",
    },

    "activity_alerts": {
        "__table__": "Alerts fired when zone productivity drops below thresholds",
        "__rules__": (
            "Open alerts: WHERE status = 'open'\n"
            "Unacknowledged: WHERE acknowledged = FALSE\n"
            "Triggered when a zone drops into IDLE or LOW_ACTIVITY state for too long"
        ),
        "alert_type": (
            "'zone_idle' = zone has been idle too long | "
            "'activity_drop' = sudden drop in activity score | "
            "'low_activity_sustained' = prolonged low productivity | "
            "'repeated_inactivity' = zone keeps going idle repeatedly"
        ),
        "severity": "'low' | 'medium' | 'high'",
        "status": "'open' | 'acknowledged' | 'resolved'",
        "zone_name": "denormalized zone name",
    },

    "equipment_alerts": {
        "__table__": "Alerts fired when equipment is detected operating unsafely or in wrong areas",
        "__rules__": (
            "Open alerts: WHERE status = 'open'\n"
            "Equipment incidents = this table"
        ),
        "alert_type": (
            "'idle_waste' = equipment sitting idle wasting time | "
            "'active_no_workers' = equipment running with no workers nearby (safety risk) | "
            "'ghost_equipment' = equipment detected in restricted/wrong zone | "
            "'overuse' = equipment active beyond safe operating hours | "
            "'cross_zone_conflict' = equipment moved into forbidden zone"
        ),
        "severity": "'low' | 'medium' | 'high'",
        "equipment_type": "type of equipment detected (e.g. 'crane', 'excavator', 'forklift')",
        "track_id": "ByteTrack track_id of the specific machine that triggered the alert",
        "status": "'open' | 'acknowledged' | 'resolved'",
        "zone_name": "denormalized zone name",
    },

    "equipment_snapshots": {
        "__table__": "Periodic equipment utilization snapshots per zone",
        "__rules__": (
            "Equipment utilization %: utilization_score * 100\n"
            "Idle equipment: idle_count or WHERE zone_status = 'UNDERUTILIZED'\n"
            "Cross-zone conflicts: WHERE cross_zone_conflicts > 0\n"
            "Latest snapshot per zone: ORDER BY recorded_at DESC GROUP BY zone_name\n"
            "Average equipment utilization today: AVG(utilization_score) WHERE DATE(recorded_at) = CURRENT_DATE"
        ),
        "active_count": "equipment units currently in active use / moving",
        "idle_count": "equipment units present but not moving / idle",
        "total_count": "total equipment units detected in this zone",
        "utilization_score": "active_count / total_count ratio 0.0-1.0 — multiply by 100 for %",
        "idle_ratio": "idle_count / total_count ratio",
        "avg_active_duration": "average seconds each active equipment unit has been running",
        "zone_status": (
            "'BALANCED' = equipment count within expected range | "
            "'UNDERUTILIZED' = too many idle machines | "
            "'OVERLOADED' = more equipment than zone can safely handle"
        ),
        "cross_zone_conflicts": "number of equipment units detected outside their designated zone",
        "zone_name": "denormalized zone name",
    },

    "workforce_zone_settings": {
        "__table__": "Staffing thresholds and alert configuration per project/camera for workforce monitoring",
        "__rules__": (
            "One row per project (or per camera if camera_id is set — camera overrides project default)\n"
            "required_workers and max_workers define the BALANCED zone band in workforce_snapshots"
        ),
        "required_workers": "minimum acceptable workers; below this = UNDERSTAFFED alert",
        "max_workers": "maximum acceptable workers; above this = OVERCROWDED alert",
        "idle_alert_threshold": "percent of workers that can be idle before alerting (0-100)",
        "camera_id": "NULL = project-level default; non-NULL = per-camera override",
    },

    "activity_zone_settings": {
        "__table__": "Productivity thresholds and alert configuration per project/camera for activity monitoring",
        "__rules__": "One row per project (or per camera if camera_id is set)",
        "idle_threshold_seconds": "seconds of no motion before zone is classified as IDLE",
        "alert_idle_minutes": "minutes a zone must be IDLE before an alert fires",
        "low_activity_threshold": "minimum % of moving workers for zone to be ACTIVE (else LOW_ACTIVITY)",
        "camera_id": "NULL = project-level default; non-NULL = per-camera override",
    },

    "equipment_zone_settings": {
        "__table__": "Equipment thresholds and safety rules per project/camera for equipment monitoring",
        "__rules__": "One row per project (or per camera if camera_id is set)",
        "expected_equipment_count": "expected equipment units in zone; below this = UNDERUTILIZED",
        "max_equipment_count": "maximum safe equipment count; above this = OVERLOADED alert",
        "idle_alert_threshold_minutes": "minutes equipment must be idle before an idle alert fires",
        "overuse_threshold_hours": "hours equipment is active before an overuse alert fires",
        "min_workers_alongside": "minimum workers required in zone when equipment is active (safety rule)",
        "camera_id": "NULL = project-level default; non-NULL = per-camera override",
    },

    "project_camera_analytics": {
        "__table__": "Per-camera analytics feature toggles — which AI capabilities are enabled",
        "__rules__": (
            "Is analytics enabled: check the relevant *_enabled flag\n"
            "Cameras with no analytics: WHERE ppe_enabled = FALSE AND workforce_enabled = FALSE AND activity_enabled = FALSE\n"
            "Join path: project_camera_analytics → project_cameras → cameras"
        ),
        "ppe_enabled": "TRUE = this camera is running PPE detection (helmet/vest)",
        "workforce_enabled": "TRUE = this camera is counting and classifying workers",
        "activity_enabled": "TRUE = this camera is measuring zone productivity",
        "equipment_enabled": "TRUE = this camera is detecting equipment movements",
        "inference_events_enabled": "TRUE = per-frame inference events are being logged",
    },

    "project_ml_config": {
        "__table__": "ML model configuration per project — confidence thresholds and ReID settings",
        "__rules__": (
            "One row per project, auto-created on project activation\n"
            "Higher confidence thresholds = fewer false positives but may miss real violations"
        ),
        "violation_frames": "consecutive frames required before logging a PPE violation (reduces false positives)",
        "stage1_conf": "confidence threshold for person detection stage (0.0-1.0)",
        "stage2_conf": "confidence threshold for PPE classification stage (0.0-1.0)",
        "reid_enabled": "TRUE = person re-identification active (tracks same person cross-camera)",
        "incident_dedup_seconds": "seconds window to suppress duplicate alerts for same person",
    },

    "project_tasks": {
        "__table__": "Project to-do tasks — both system-generated (setup wizard) and manually created",
        "__rules__": (
            "Pending tasks: WHERE is_done = FALSE\n"
            "Completed tasks: WHERE is_done = TRUE\n"
            "Setup tasks: WHERE auto_generated = TRUE"
        ),
        "is_done": "TRUE = task completed | FALSE = pending",
        "auto_generated": "TRUE = system created this task | FALSE = manually created by user",
        "assigned_role": "which project role is responsible (e.g. 'project_manager', 'safety_officer')",
        "done_at": "NULL = not done yet",
    },

    "notes": {
        "__table__": "Project notes and daily logs written by team members",
        "__rules__": (
            "Starred notes: WHERE is_favourite = TRUE\n"
            "Notes by category: WHERE category = 'safety' etc."
        ),
        "category": "user-defined category tag (e.g. 'safety', 'daily-log', 'inspection')",
        "is_favourite": "TRUE = user marked this note as important/starred",
    },

    "notifications": {
        "__table__": "In-app notifications sent to users for alerts, lifecycle events, and tasks",
        "__rules__": (
            "Unread: WHERE is_read = FALSE\n"
            "Critical alerts sent: WHERE priority = 'critical'\n"
            "PPE notifications: WHERE category = 'ppe'"
        ),
        "category": (
            "'ppe' = PPE violation notification | "
            "'camera' = camera health/connectivity | "
            "'project' = project lifecycle | "
            "'task' = task assigned/completed | "
            "'account' = account-level notification"
        ),
        "priority": "'critical' | 'high' | 'medium' | 'low'",
        "is_read": "FALSE = user has not read this notification yet",
    },

    "risk_events": {
        "__table__": "Risk escalation events — logged when risk scores cross severity thresholds",
        "__rules__": (
            "Active risks: WHERE status = 'open'\n"
            "Critical risks: WHERE severity = 'critical'\n"
            "Unresolved high risks: WHERE severity IN ('high','critical') AND status = 'open'\n"
            "Today's risk events: WHERE DATE(triggered_at) = CURRENT_DATE\n"
            "Risk worsening: WHERE event_type = 'risk_escalated' AND risk_score > previous_risk_score"
        ),
        "event_type": (
            "'risk_escalated' = risk score crossed a severity threshold upward | "
            "'risk_resolved' = risk score dropped back to safe level | "
            "'compound_risk' = multiple risk signals coincide | "
            "'prediction_alert' = AI predicts risk will increase soon | "
            "'weather_impact' = weather conditions are elevating risk"
        ),
        "severity": "'low' | 'medium' | 'high' | 'critical'",
        "risk_score": "risk score at the time this event was triggered (0.0-1.0 scale)",
        "previous_risk_score": "risk score before this event (to show the change)",
        "status": "'open' = risk not yet mitigated | 'acknowledged' | 'resolved'",
        "zone_name": "denormalized zone name",
    },

    "risk_snapshots": {
        "__table__": "Periodic composite risk score snapshots per zone — includes weather and AI predictions",
        "__rules__": (
            "Current risk score: most recent snapshot ORDER BY recorded_at DESC LIMIT 1 per zone\n"
            "High risk zones: WHERE risk_level IN ('high','critical') in latest snapshot\n"
            "Risk trend: ORDER BY recorded_at ASC, track overall_risk over time\n"
            "IMPORTANT: use 'overall_risk' NOT 'risk_score' — that column does not exist here\n"
            "overall_risk > 75 = critical; 50-75 = high; 25-50 = moderate; < 25 = low\n"
            "Worsening zones: WHERE trend = 'rising' in latest snapshot"
        ),
        "delay_risk": "0-100 schedule/delay risk score for this zone",
        "safety_risk": "0-100 safety risk score (PPE violations, equipment conflicts)",
        "productivity_risk": "0-100 productivity risk score (idle workers, low activity)",
        "overall_risk": "0-100 combined composite risk score (weighted blend of delay+safety+productivity)",
        "risk_level": "'low' (0-25) | 'moderate' (25-50) | 'high' (50-75) | 'critical' (75-100)",
        "trend": "'rising' = risk getting worse | 'stable' | 'decreasing' = improving",
        "momentum": "positive = risk worsening faster | negative = improving | 0 = stable",
        "prediction_risk": "AI-predicted risk score in the near future (NULL if not computed)",
        "compound_risk_flag": "TRUE = multiple risk signals coincide, more dangerous than score alone",
        "zone_name": "denormalized zone name",
    },

    "auth_events": {
        "__table__": "Audit log for all authentication and project lifecycle events",
        "__rules__": (
            "Failed logins: WHERE event_type = 'login_failed'\n"
            "Login history: WHERE event_type = 'login_success'\n"
            "Project activity log: WHERE event_type LIKE 'project_%'\n"
            "Parse 'extra' column as JSON to get specific field values"
        ),
        "event_type": (
            "'login_success' | 'login_failed' | 'logout' | 'token_refresh' | "
            "'project_created' | 'project_archived' | 'project_deleted' | "
            "'pm_invited' | 'invitation_accepted' | 'user_approved'"
        ),
        "extra": "JSON string with additional context (e.g. project_name, pm_email)",
    },

    "scheduler_config": {
        "__table__": "Camera health check scheduler configuration — singleton table with one row",
        "__rules__": (
            "Always exactly one row with id=1\n"
            "Is health check running: WHERE enabled = TRUE\n"
            "Do not GROUP BY or COUNT — it is a singleton config table"
        ),
        "enabled": "TRUE = camera health scheduler is running | FALSE = paused",
        "interval_minutes": "how often to poll camera health (default: 5 minutes)",
    },

    "project_settings": {
        "__table__": "Per-project global settings — alert muting and report frequency",
        "__rules__": (
            "One row per project, auto-created on project activation\n"
            "If alerts_enabled = FALSE, no alerts are sent for this project"
        ),
        "alerts_enabled": "FALSE = all alerts globally muted for this project",
        "report_frequency": "how often to generate reports (e.g. 'daily', 'weekly')",
    },

    "refresh_tokens": {
        "__table__": "Refresh token records for session management — admin access only",
        "__rules__": (
            "Active sessions: WHERE revoked = FALSE AND expires_at > NOW()\n"
            "Sessions per user: COUNT(*) WHERE revoked = FALSE GROUP BY user_id\n"
            "Do NOT SELECT token_hash — it is sensitive. Only use COUNT, dates, or boolean flags.\n"
            "Admin only: this table is restricted to admin role queries only"
        ),
        "token_hash": "SENSITIVE — NEVER SELECT this column",
        "revoked": "TRUE = token has been invalidated (logout or rotation)",
        "family": "token family identifier for theft detection",
        "remember": "TRUE = user chose 'remember me' (longer token lifetime)",
        "token_version": "must match users.token_version; mismatch = token invalidated",
    },

    "smart_query_history": {
        "__table__": "History of Smart Query Assistant queries — one row per user question",
        "__rules__": (
            "User's history: WHERE user_id = :user_id ORDER BY created_at DESC\n"
            "Conversation thread: WHERE conversation_id = :cid ORDER BY created_at ASC"
        ),
        "conversation_id": "UUID grouping related follow-up questions into one conversation session",
        "mode": "'standard' = single SQL query | 'deep' = multi-SQL parallel analysis",
        "cached": "TRUE = result served from cache (no new DB query was run)",
    },
}
