# MIFOS + EZVIZ CCTV Transaction Evidence System

## Technical Implementation Instructions

**Document purpose:** Build a reusable CCTV integration module for the
Mifos web-based pawn management system. The solution must first work in
a test environment with one EZVIZ camera, then be deployable to every
branch with branch-specific configuration.

------------------------------------------------------------------------

## 1. Project Objective

The system must connect a branch-local EZVIZ camera to the Mifos pawn
transaction workflow.

### Required behavior

When a cashier completes a pawn transaction:

1.  Mifos creates/completes the pawn transaction.
2.  The CCTV system identifies the transaction event.
3.  The CCTV recorder extracts a 20-second evidence clip.
4.  The clip contains:
    -   10 seconds before the transaction trigger
    -   10 seconds after the transaction trigger
5.  The MP4 file is linked to the Mifos Pawn/Transaction ID.
6.  Authorized users can view the CCTV evidence from the Mifos
    transaction.
7.  The same architecture must work for multiple branches and cameras.

### Example

``` text
Pawn ID:       PN202609080001
Cashier:       CASHIER01
Branch:        BR001
Camera:        CAM001
Event time:    2026-09-08 10:35:30
Video window:  10:35:20 - 10:35:40
Duration:      20 seconds
Video file:    PN202609080001.mp4
```

------------------------------------------------------------------------

# 2. Camera

## Current test camera

**Manufacturer:** EZVIZ\
**Model shown on the camera label:** CS-H6c\
**Model/version family:** CS-H6c-R105-1L3WF\
**Resolution:** 3MP class / 2304 × 1296\
**Lens:** 4 mm\
**Connectivity:** Wi-Fi / Ethernet depending on installation\
**Protocols to test:** ONVIF and RTSP

The exact ONVIF/RTSP capability must be verified on the actual camera
firmware before production rollout.

Do not hard-code camera-vendor behavior into the Mifos frontend.

------------------------------------------------------------------------

# 3. High-Level Architecture

The recommended production architecture is:

``` text
                         CENTRAL MIFOS WEB APP
                                  |
                           HTTPS / WSS API
                                  |
             +--------------------+--------------------+
             |                                         |
          BRANCH 01                                  BRANCH 02
             |                                         |
      +------v-------+                          +------v-------+
      | CCTV AGENT   |                          | CCTV AGENT   |
      | Local Service|                          | Local Service|
      +------|-------+                          +------|-------+
             |                                         |
        EZVIZ CAMERA                              EZVIZ CAMERA
        ONVIF / RTSP                              ONVIF / RTSP
```

## Critical architecture rule

**Mifos must not directly connect to branch cameras.**

Instead:

``` text
EZVIZ Camera
     |
     v
Branch-local CCTV Agent
     |
     v
Secure outbound HTTPS/WSS
     |
     v
Mifos CCTV API
```

This keeps cameras behind the branch LAN and avoids exposing camera
ports to the public Internet.

------------------------------------------------------------------------

# 4. Branch Network Design

Each branch can use a structure similar to:

``` text
Branch Router
    |
    +---- Cashier PC
    |
    +---- Mifos Web Access
    |
    +---- CCTV Agent PC / Service
              |
              +---- EZVIZ Camera
```

## Camera networking requirements

For each camera:

-   Give the camera a stable local IP.
-   Prefer DHCP reservation or a properly assigned static IP.
-   Keep the camera and CCTV Agent on the same branch LAN where
    practical.
-   Do not expose camera RTSP/ONVIF ports directly to the Internet.
-   Use secure outbound communication from the CCTV Agent to the central
    Mifos server.

Example:

``` text
Branch ID: BR001
Camera ID: CAM001
Camera IP: 192.168.10.50
```

------------------------------------------------------------------------

# 5. CCTV Agent

The CCTV Agent is the key component that makes the solution reusable
across branches.

## Responsibilities

The agent should:

1.  Discover/connect to configured cameras.
2.  Authenticate with the camera.
3.  Receive the local camera stream.
4.  Maintain a rolling video buffer.
5.  Provide live-view functionality where supported.
6.  Provide manual recording.
7.  Provide snapshots.
8.  Provide PTZ/pan/tilt control where supported.
9.  Receive transaction-recording commands from Mifos.
10. Generate the 20-second evidence clip.
11. Store the clip temporarily.
12. Upload/store the clip in the configured storage.
13. Send recording metadata to Mifos.
14. Report camera/agent health status.
15. Write local logs.

------------------------------------------------------------------------

# 6. Suggested CCTV Agent Directory

Windows test environment:

``` text
C:\MIFOS-CCTV\
    agent.exe
    config.json
    cameras.json
    recordings\
    temp\
    logs\
```

The agent should preferably run as a Windows Service in production so it
starts automatically after reboot.

------------------------------------------------------------------------

# 7. Agent Configuration

Use configuration instead of hard-coding branch/camera values.

Example:

``` json
{
  "branch_id": "BR001",
  "agent_id": "CCTV-BR001",
  "server": "https://mifos.example.com",
  "camera": {
    "id": "CAM001",
    "name": "Cashier Counter 01",
    "ip": "192.168.10.50",
    "protocol": "ONVIF"
  },
  "recording": {
    "before_seconds": 10,
    "after_seconds": 10,
    "format": "mp4"
  }
}
```

For another branch, the software should remain the same; only
configuration should change.

Example:

``` text
BR001 -> CCTV Agent -> CAM001
BR002 -> CCTV Agent -> CAM002
BR003 -> CCTV Agent -> CAM003
...
BR012 -> CCTV Agent -> CAM012
```

------------------------------------------------------------------------

# 8. Recording Architecture

Do not start a completely new recording only when the cashier clicks
Complete.

Instead, maintain a rolling buffer.

``` text
Camera
   |
   v
RTSP/ONVIF Stream
   |
   v
FFmpeg / Recording Engine
   |
   v
Rolling Buffer
```

When Mifos sends the transaction event:

``` text
                  TRANSACTION EVENT
                         |
                         v
          +--------------+--------------+
          |                             |
     10 sec BEFORE                 10 sec AFTER
          |                             |
          +--------------+--------------+
                         |
                         v
                    20-sec MP4
```

This is more reliable because the beginning of the cashier/customer
interaction is already present before the transaction is completed.

------------------------------------------------------------------------

# 9. FFmpeg / Video Processing

Use FFmpeg or another suitable local video-processing engine.

The CCTV Agent should maintain short rolling segments rather than one
huge file.

Conceptually:

``` text
Camera Stream
     |
     +--> Segment -10
     +--> Segment -09
     +--> Segment -08
     ...
     +--> Segment 00
     +--> Current segment
```

When a transaction trigger arrives, the agent selects the required time
range and creates:

``` text
PN202609080001.mp4
```

The final implementation should ensure the resulting clip is as close as
practical to exactly 20 seconds.

------------------------------------------------------------------------

# 10. Mifos Transaction Trigger

The preferred trigger is the server-side completion of a pawn
transaction.

Example flow:

``` text
Cashier
   |
   v
New Pawn
   |
   v
Customer
   |
   v
Item
   |
   v
Valuation
   |
   v
Loan Amount
   |
   v
Payment
   |
   v
COMPLETE PAWN
   |
   v
Mifos creates transaction
   |
   v
CCTV Capture Request
   |
   v
CCTV Agent
```

Do not rely only on a browser button click if the backend already has a
definitive transaction-completion event.

The backend transaction event should be the authoritative trigger.

------------------------------------------------------------------------

# 11. CCTV Capture API

A dedicated API layer should exist between Mifos and the CCTV Agent.

Example logical request:

``` http
POST /api/cctv/capture
```

Example payload:

``` json
{
  "branch_id": "BR001",
  "camera_id": "CAM001",
  "pawn_id": "PN202609080001",
  "cashier_id": "CASHIER01",
  "event_time": "2026-09-08T10:35:30",
  "before_seconds": 10,
  "after_seconds": 10
}
```

The agent responds with a job ID:

``` json
{
  "job_id": "CCTVJOB000001",
  "status": "processing"
}
```

After processing:

``` json
{
  "job_id": "CCTVJOB000001",
  "status": "completed",
  "pawn_id": "PN202609080001",
  "video_path": "/videos/BR001/2026/09/PN202609080001.mp4",
  "duration_seconds": 20
}
```

------------------------------------------------------------------------

# 12. Database Design

Do not store the MP4 binary directly in MySQL unless there is a strong
technical reason.

Store video files in dedicated file/object storage and store metadata in
MySQL.

## Table: cctv_cameras

Suggested fields:

``` text
id
branch_id
camera_name
camera_ip
camera_model
camera_protocol
agent_id
status
created_at
updated_at
```

## Table: cctv_recordings

Suggested fields:

``` text
id
branch_id
camera_id
pawn_id
cashier_id
start_time
end_time
duration
file_path
file_size
status
created_at
```

## Table: cctv_audit_logs

Suggested fields:

``` text
id
user_id
branch_id
camera_id
action
timestamp
ip_address
metadata
```

------------------------------------------------------------------------

# 13. Video Storage

Recommended structure:

``` text
/videos/
   BR001/
      2026/
         09/
            PN202609080001.mp4

   BR002/
      2026/
         09/
            PN202609080002.mp4
```

The database stores a reference such as:

``` text
/videos/BR001/2026/09/PN202609080001.mp4
```

For a larger deployment, use object storage or a dedicated central video
storage server rather than keeping all videos on the Mifos application
server.

------------------------------------------------------------------------

# 14. Mifos CCTV Module

The Mifos web application should expose CCTV as a separate module.

Suggested menu:

``` text
MIFOS
|
+-- Pawning
+-- Customers
+-- Cashier
+-- Payments
+-- Branches
|
+-- CCTV
    |
    +-- Cameras
    +-- Live View
    +-- PTZ Control
    +-- Recordings
    +-- Transaction Evidence
    +-- Playback
    +-- Download
    +-- Audit Logs
```

------------------------------------------------------------------------

# 15. CCTV User Roles

## Cashier

Allow:

-   Live View of authorized counter/camera
-   Snapshot
-   Transaction-linked recording
-   Manual recording if required
-   View evidence associated with authorized transactions

Do not allow unrestricted access to every branch camera.

## Branch Manager

Allow:

-   Branch camera live view
-   Playback
-   Transaction evidence
-   Evidence download
-   Camera health/status
-   PTZ control where supported
-   Branch-level audit logs

## System Administrator

Allow:

-   All branches
-   All cameras
-   Camera registration/configuration
-   Agent registration
-   Recording configuration
-   Storage configuration
-   System-wide audit logs
-   Evidence access according to organizational policy

------------------------------------------------------------------------

# 16. Live View

The Mifos interface should provide a camera page such as:

``` text
+----------------------------------------------+
| CCTV - Cashier Counter 01                    |
+----------------------------------------------+
|                                              |
|              LIVE CAMERA                     |
|                                              |
|             2304 x 1296                     |
|                                              |
+----------------------------------------------+
|       UP                                     |
|    LEFT  ●  RIGHT                            |
|       DOWN                                   |
|                                              |
| [Snapshot] [Start Record] [Stop Record]     |
+----------------------------------------------+
```

The exact browser streaming mechanism should be selected after the local
camera stream is verified.

Do not assume that a raw RTSP URL can be played directly by every modern
browser.

------------------------------------------------------------------------

# 17. PTZ / Manual Camera Control

The H6c is a pan/tilt camera. The CCTV Agent should expose supported
camera controls through its local API.

Conceptually:

``` text
       UP
        ^
        |
LEFT <- O -> RIGHT
        |
        v
      DOWN
```

The agent translates Mifos UI commands into ONVIF/vendor-supported
camera commands.

Important:

-   PTZ support must be verified against the exact firmware.
-   Do not implement camera-specific commands in the Mifos frontend.
-   Keep camera control inside the CCTV Agent abstraction.

------------------------------------------------------------------------

# 18. Security Requirements

Because CCTV evidence is associated with financial transactions,
security is a major requirement.

## Never use

``` text
Internet
   |
Port Forwarding
   |
Camera
```

## Use

``` text
Camera
   |
Local CCTV Agent
   |
Outbound HTTPS/WSS
   |
Mifos Server
```

### Required controls

-   HTTPS for server communication.
-   Authentication between CCTV Agent and Mifos.
-   Per-agent credentials or tokens.
-   Secure camera credentials.
-   Role-based access control.
-   Branch-level data isolation.
-   Audit logging for playback and downloads.
-   Restricted video download permissions.
-   Camera IP isolation where practical.
-   Retention policy for video evidence.
-   Secure deletion after the retention period.
-   Agent health monitoring.
-   No plaintext passwords in source code.

------------------------------------------------------------------------

# 19. Branch Data Isolation

Every CCTV object must be associated with a branch.

Example:

``` text
BR001
  |
  +-- CAM001
  +-- Agent BR001
  +-- Pawn evidence
```

A user assigned to BR001 must not automatically receive access to BR002
CCTV data.

The server should validate:

``` text
logged_in_user.branch_id
        ==
requested_recording.branch_id
```

unless the user has an administrative role that permits cross-branch
access.

------------------------------------------------------------------------

# 20. Transaction-to-CCTV Relationship

The core relationship should be:

``` text
Pawn Transaction
       |
       +---- Pawn ID
       |
       +---- Cashier
       |
       +---- Branch
       |
       +---- Payment
       |
       +---- CCTV Recording
                    |
                    +---- Camera
                    +---- Start time
                    +---- End time
                    +---- Video file
```

Example:

``` text
PN202609080001
    |
    +-- Cashier: CASHIER01
    +-- Branch: BR001
    +-- Amount: Rs. 75,000
    +-- Transaction Time: 10:35:30
    |
    +-- CCTV Evidence
          |
          +-- CAM001
          +-- 10:35:20
          +-- 10:35:40
          +-- PN202609080001.mp4
```

The Mifos transaction screen should show:

``` text
[ View CCTV Evidence ]
```

------------------------------------------------------------------------

# 21. Error Handling

The pawn transaction must not silently fail merely because CCTV capture
fails.

Recommended behavior:

``` text
Pawn transaction
      |
      v
Transaction committed
      |
      +---- CCTV capture requested
                 |
          +------+------+
          |             |
       SUCCESS        FAILURE
          |             |
      Evidence       Retry/Alert
      linked         + audit log
```

CCTV failure should generate a clear status:

``` text
CCTV Status: CAPTURE FAILED
Reason: Camera unavailable
Retry: Available
```

Do not roll back a valid financial transaction only because the camera
is temporarily unavailable unless business requirements explicitly
demand such behavior.

------------------------------------------------------------------------

# 22. CCTV Job Queue

For production, asynchronous jobs are preferable.

``` text
Mifos
  |
  v
CCTV Capture Job
  |
  v
Queue
  |
  v
Branch CCTV Agent
  |
  v
Video creation
  |
  v
Storage
  |
  v
Mifos recording metadata update
```

This prevents video processing from slowing down the cashier's
transaction request.

------------------------------------------------------------------------

# 23. Test Environment

Start with one camera and one PC.

``` text
TEST PC
|
+-- XAMPP
|    +-- Apache
|    +-- PHP
|    +-- MySQL
|
+-- Mifos Web Application
|
+-- CCTV Agent
|
+-- FFmpeg
|
+-- Local Network
       |
       +-- EZVIZ H6c Camera
```

------------------------------------------------------------------------

# 24. Phase 1 - Camera Connectivity Test

Before developing the full system:

1.  Connect the EZVIZ camera to the test LAN.
2.  Find the camera's local IP address.
3.  Confirm the camera can be reached from the test PC.
4.  Check the camera firmware.
5.  Verify ONVIF availability.
6.  Verify RTSP availability.
7.  Confirm camera authentication.
8.  Confirm live stream.
9.  Confirm pan/tilt control where supported.

Do not proceed to the transaction recorder until local streaming is
stable.

------------------------------------------------------------------------

# 25. Phase 2 - Build the CCTV Agent

Implement:

``` text
Camera Connection
       |
       +-- Authentication
       +-- Stream Reader
       +-- Rolling Buffer
       +-- Live View API
       +-- Snapshot API
       +-- Manual Record API
       +-- PTZ API
       +-- Transaction Capture API
       +-- Health API
       +-- Logging
```

------------------------------------------------------------------------

# 26. Phase 3 - Rolling Buffer

The agent should continuously maintain enough recent footage to extract
at least the required 10 seconds before the transaction.

Recommended buffer:

``` text
Minimum: 10 seconds
Recommended: 30-60 seconds
```

A larger buffer provides protection against delays in transaction
processing.

------------------------------------------------------------------------

# 27. Phase 4 - 20-Second Evidence

When the transaction completion event occurs:

``` text
Event time = T

Capture:
T - 10 seconds
to
T + 10 seconds
```

Result:

``` text
20-second MP4
```

The filename should contain a unique transaction identifier:

``` text
PN202609080001.mp4
```

If one pawn can have multiple evidence clips, use:

``` text
PN202609080001_CAM001_20260908_103530.mp4
```

------------------------------------------------------------------------

# 28. Phase 5 - Mifos Integration

Add a CCTV API/service layer.

Suggested logical endpoints:

``` text
GET  /api/cctv/cameras
GET  /api/cctv/cameras/{id}/status
GET  /api/cctv/cameras/{id}/stream
POST /api/cctv/cameras/{id}/snapshot
POST /api/cctv/cameras/{id}/ptz
POST /api/cctv/recordings/capture
GET  /api/cctv/recordings/{id}
GET  /api/cctv/pawn/{pawn_id}/recordings
POST /api/cctv/agents/register
POST /api/cctv/agents/heartbeat
```

The exact API implementation can be adapted to the existing Mifos
backend.

------------------------------------------------------------------------

# 29. Phase 6 - Playback

From the pawn transaction page:

``` text
Pawn Details
     |
     +-- Financial Information
     +-- Customer Information
     +-- Cashier Information
     |
     +-- CCTV Evidence
            |
            +-- View
            +-- Playback
            +-- Download (authorized users only)
```

------------------------------------------------------------------------

# 30. Phase 7 - Audit Logging

Record at minimum:

``` text
User
Branch
Camera
Action
Timestamp
IP Address
Recording ID
```

Actions should include:

``` text
LIVE_VIEW
SNAPSHOT
START_RECORD
STOP_RECORD
PTZ_CONTROL
PLAYBACK
DOWNLOAD
DELETE
CONFIG_UPDATE
```

This is especially important for financial and dispute/audit scenarios.

------------------------------------------------------------------------

# 31. Multi-Branch Deployment

Once BR001 is stable, package the CCTV Agent for deployment.

Example:

``` text
BR001 -> Agent -> CAM001
BR002 -> Agent -> CAM001
BR003 -> Agent -> CAM001
...
BR012 -> Agent -> CAM001
```

The same software can be reused. Configuration identifies the branch and
camera.

For multiple cashier counters:

``` text
BR001
 |
 +-- CAM001 -> Cashier Counter 01
 +-- CAM002 -> Cashier Counter 02
 +-- CAM003 -> Cashier Counter 03
```

The architecture should therefore support one-to-many cameras per branch
from the beginning.

------------------------------------------------------------------------

# 32. Camera Registry

Mifos should have a camera registration screen:

``` text
Camera Name
Camera ID
Branch
Local IP
Protocol
Agent
Status
Location / Counter
Enabled
```

Example:

``` text
CAM001
Cashier Counter 01
BR001
192.168.10.50
ONVIF
CCTV-BR001
ONLINE
```

------------------------------------------------------------------------

# 33. Agent Health Monitoring

The CCTV Agent should periodically send a heartbeat.

Example:

``` text
Agent ID: CCTV-BR001
Status: ONLINE
Last heartbeat: 10:35:30
Camera: CAM001
Camera status: ONLINE
Disk free: 120 GB
CPU: 18%
```

If the agent stops responding:

``` text
BR001 CCTV Agent: OFFLINE
```

The Mifos admin/manager should receive an alert.

------------------------------------------------------------------------

# 34. Storage and Retention

Define a business retention policy before production.

Example policy structure:

``` text
Recent evidence -> online storage
Older evidence -> archive
Expired evidence -> secure deletion
```

Retention duration should be decided by the company's legal, audit and
operational requirements.

Do not permanently retain every video without a defined policy.

------------------------------------------------------------------------

# 35. Reliability Requirements

The system should handle:

-   Camera temporarily offline.
-   CCTV Agent restart.
-   PC restart.
-   Network interruption.
-   Mifos server temporarily unavailable.
-   Storage temporarily unavailable.
-   Incomplete video segment.
-   Duplicate capture requests.
-   Transaction retry.
-   Camera reboot.

Use:

``` text
Retry
Queue
Idempotency
Health checks
Audit logs
```

for production reliability.

------------------------------------------------------------------------

# 36. Recommended Idempotency Rule

A capture request should have a unique ID.

Example:

``` text
CCTVJOB-BR001-PN202609080001
```

If the same transaction event is received twice, the agent should not
create duplicate evidence clips unnecessarily.

------------------------------------------------------------------------

# 37. Final Production Architecture

``` text
                         CENTRAL MIFOS
                              |
                       CCTV API Layer
                              |
              +---------------+---------------+
              |                               |
       BRANCH CCTV AGENT               BRANCH CCTV AGENT
              |                               |
       +------+------+                  +-----+------+
       |             |                  |            |
    EZVIZ CAM     EZVIZ CAM          EZVIZ CAM    EZVIZ CAM
       |             |                  |            |
    Buffer        Buffer             Buffer       Buffer
       |             |                  |            |
       +------20-sec Evidence-----------+------------+
                              |
                        Video Storage
                              |
                        Recording Metadata
                              |
                         Mifos Pawn ID
```

------------------------------------------------------------------------

# 38. Recommended Development Order

Do not build all features simultaneously.

Implement in this exact order:

``` text
1. Camera IP and connectivity
2. ONVIF/RTSP verification
3. Live stream
4. Manual PTZ
5. Snapshot
6. Manual recording
7. Rolling buffer
8. 20-second clip extraction
9. CCTV Agent API
10. Mifos CCTV database tables
11. Mifos transaction trigger
12. Automatic transaction evidence
13. Playback
14. Role-based access
15. Audit logs
16. Agent heartbeat/health monitoring
17. Storage/retention
18. One-branch pilot
19. Multi-camera support
20. Multi-branch rollout
```

------------------------------------------------------------------------

# 39. Important Implementation Principle

The Mifos application should know **what camera evidence belongs to a
transaction**, but it should not know the vendor-specific details of how
an EZVIZ camera is controlled.

Use this abstraction:

``` text
Mifos
  |
  | CCTV API
  v
CCTV Agent
  |
  +-- ONVIF Adapter
  +-- RTSP Adapter
  +-- FFmpeg Recorder
  +-- Storage Adapter
```

This makes it possible to replace EZVIZ with another ONVIF-compatible
camera later without redesigning the Mifos application.

------------------------------------------------------------------------

# 40. Final Goal

The completed system should provide this user experience:

``` text
Cashier
   |
   v
Complete Pawn
   |
   v
Mifos Transaction Created
   |
   v
CCTV Capture Automatically Triggered
   |
   v
10 sec Before + 10 sec After
   |
   v
20-sec MP4
   |
   v
Stored Securely
   |
   v
Linked to Pawn ID
   |
   v
Mifos -> View CCTV Evidence
```

The final solution is therefore a **branch-local CCTV Agent +
centralized Mifos CCTV API/module + secure video storage +
transaction-linked evidence system**.

This architecture is intended to be tested first with the current EZVIZ
H6c camera and then standardized for deployment across all Mifos
branches.
