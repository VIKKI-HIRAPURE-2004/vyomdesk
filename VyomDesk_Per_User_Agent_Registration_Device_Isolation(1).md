# VyomDesk – Per-User Agent Registration & Device Isolation

## 1. Objective

VyomDesk mein har registered user ko sirf wahi client PCs dikhne chahiye jo us particular user ke account/agent installation se registered hue hain.

### Required behavior

1. User website par register kare:
   - Name
   - Email
   - Password
2. User login kare.
3. Dashboard mein **Add Device** option dikhe.
4. User **Download Agent** par click kare.
5. VyomDesk Agent `.exe` download ho.
6. Jo agent particular user ke dashboard se download hua hai, usse kisi client PC par install karne ke baad:
   - Client PC automatically us particular user's VyomDesk account se bind ho.
   - Device us user ke dashboard mein show ho.
7. Client PC restart hone ke baad:
   - VyomDesk Agent automatically start ho.
   - Server se automatically authenticate/reconnect ho.
   - Device dashboard mein **Online** show ho, jab PC/agent available ho.
8. Kisi user ko doosre users ke devices kabhi nahi dikhne chahiye.

---

# 2. Expected User Flow

```text
USER
 |
 +-- Register
 |     +-- Name
 |     +-- Email
 |     +-- Password
 |
 +-- Login
 |
 +-- Dashboard
       |
       +-- Add Device
             |
             +-- Download VyomDesk Agent
                        |
                        v
                 VyomDesk-Agent.exe
                        |
                        v
                  Client PC Install
                        |
                        v
             Agent gets installation identity
                        |
                        v
                 Backend Registration
                        |
                        v
                  User Dashboard
                  +-- Client PC ONLINE
```

---

# 3. Per-User Device Isolation

The most important requirement is:

> An agent downloaded from User A's dashboard must belong only to User A.

Similarly:

```text
User A
  |
  +-- Agent Token A
        |
        +-- PC-A1
        +-- PC-A2
        +-- PC-A3
```

```text
User B
  |
  +-- Agent Token B
        |
        +-- PC-B1
        +-- PC-B2
```

Dashboard result:

```text
USER A DASHBOARD
----------------
PC-A1
PC-A2
PC-A3
```

```text
USER B DASHBOARD
----------------
PC-B1
PC-B2
```

User A must NOT see PC-B1 or PC-B2.

User B must NOT see PC-A1, PC-A2 or PC-A3.

---

# 4. Do NOT Use a Global Device List

Current problem:

> Every user can see previously added clients from the entire site.

This must be fixed.

The application must not simply fetch:

```sql
SELECT * FROM devices;
```

Instead, every device must have an owner:

```text
devices
-------
id
user_id
device_id
device_name
status
last_seen
agent_version
created_at
```

The `user_id` is the owner of the device.

---

# 5. Database Structure

## Users

```text
users
-----
id
name
email
password_hash
created_at
updated_at
```

## Installation Tokens

Create a separate table for agent installation tokens:

```text
installation_tokens
-------------------
id
user_id
token_hash
status
expires_at
created_at
used_at
```

Possible status values:

```text
active
used
revoked
expired
```

## Devices

```text
devices
-------
id
user_id
device_id
device_name
status
last_seen
agent_version
created_at
updated_at
```

The important relationship is:

```text
installation_tokens.user_id
            |
            v
       devices.user_id
```

---

# 6. Agent Download Process

When User A logs in:

```text
User A
  |
  v
Dashboard
  |
  v
Add Device
  |
  v
Generate Installation Token
  |
  v
Download Agent
```

Example:

```text
User ID: 7821

Installation Token:
VD-8F7A-92KD-XXXX
```

The downloaded agent must be associated with this installation token.

Do NOT use one permanent/global token for every customer.

---

# 7. Agent Registration

When the client installs and starts the agent:

```text
VyomDesk Agent
      |
      v
Read installation identity/token
      |
      v
HTTPS request to VyomDesk Backend
      |
      v
Validate token
      |
      v
Find token.user_id
      |
      v
Create/Register Device
      |
      v
devices.user_id = token.user_id
```

Example:

```text
Installation Token
        |
        v
user_id = 7821
        |
        v
New Device
        |
        v
devices.user_id = 7821
```

After successful registration, the agent should receive a secure device credential/session identity so that it does not need to reuse the one-time installation token on every connection.

---

# 8. One-Time Installation Token

The installation token should preferably be used only for initial device registration.

Recommended flow:

```text
Generate Token
      |
      v
Download Agent
      |
      v
Install Agent
      |
      v
Register Device
      |
      v
Token marked USED
      |
      v
Agent receives secure device credential
```

This reduces the risk of someone reusing a leaked installation token.

The token should also support:

- Expiration
- Revocation
- One-time use
- Secure storage
- Server-side hashing where practical

---

# 9. Device Ownership Security

Every device API must verify ownership.

Example:

```text
Logged-in User ID = 7821
Requested Device ID = 105
```

Backend must check:

```text
device.user_id == logged_in_user.id
```

Only then should the operation continue.

This check must happen on the backend/server, not only in frontend JavaScript.

---

# 10. Dashboard Device API

Incorrect:

```sql
SELECT *
FROM devices;
```

Correct:

```sql
SELECT *
FROM devices
WHERE user_id = logged_in_user_id;
```

For example:

```text
Logged-in user:
user_id = 7821
```

The backend returns only:

```text
PC-A1
PC-A2
PC-A3
```

It must never return another user's devices.

---

# 11. API Authorization

Ownership checks should exist for every device-related operation.

Examples:

```text
GET    /api/devices
GET    /api/devices/:id
POST   /api/devices/:id/connect
POST   /api/devices/:id/disconnect
DELETE /api/devices/:id
GET    /api/devices/:id/status
```

For a device-specific request:

```text
1. Authenticate user
2. Get logged-in user ID
3. Find requested device
4. Verify device.user_id == logged-in user ID
5. Allow operation
```

If ownership does not match:

```text
HTTP 403 Forbidden
```

or an equivalent secure response should be returned.

---

# 12. Prevent IDOR / Cross-User Access

The system must prevent a user from changing a device ID in a request and accessing another user's device.

Example attack:

```text
User A owns:
device_id = 101
```

User B tries:

```text
GET /api/devices/101
```

Backend must check:

```text
101 belongs to User A
User B != User A
```

Result:

```text
ACCESS DENIED
```

Do not rely only on hiding the device from the dashboard.

---

# 13. Agent Auto-Start After Windows Restart

The VyomDesk Agent should automatically start after Windows restart.

Expected flow:

```text
Windows PC ON
      |
      v
Windows starts
      |
      v
VyomDesk Agent starts automatically
      |
      v
Agent authenticates
      |
      v
Connects to VyomDesk Server
      |
      v
Heartbeat / WebSocket connection
      |
      v
Dashboard = ONLINE
```

Possible implementation approaches:

- Windows Service
- Startup mechanism
- Properly configured background agent

For a production remote-support application, a Windows Service is generally preferable for reliable background operation.

---

# 14. Online / Offline Status

The agent should maintain a heartbeat or persistent connection.

Example:

```text
Agent
  |
  +-- heartbeat
  +-- heartbeat
  +-- heartbeat
  +-- heartbeat
```

Backend updates:

```text
last_seen = current_time
status = online
```

If heartbeats stop for the configured timeout:

```text
status = offline
```

Example:

```text
PC ON
Agent Running
Connection Active
      |
      v
ONLINE
```

```text
PC OFF / Agent Stopped / Connection Lost
      |
      v
No heartbeat
      |
      v
OFFLINE
```

---

# 15. Reconnection

The agent should automatically reconnect when the network temporarily goes down.

Recommended behavior:

```text
Connection Lost
      |
      v
Wait
      |
      v
Reconnect
      |
      +---- Success ---> ONLINE
      |
      +---- Failed ----> Retry with backoff
```

Use controlled retry/backoff rather than continuously creating rapid connection attempts.

---

# 16. Device Identification

Each client device should have a unique device identity.

Suggested fields:

```text
device_id
device_name
user_id
status
last_seen
agent_version
```

The device ID should be generated securely and should not depend only on easily spoofed values such as the computer name.

Example:

```text
device_id = secure unique identifier
device_name = "Vikki Office PC"
```

---

# 17. Multiple Devices for One User

One user should be able to install the agent on multiple PCs.

Example:

```text
User A
 |
 +-- PC-Office
 +-- PC-Home
 +-- PC-Laptop
 +-- PC-Server
```

All of these devices should appear only under User A's account.

---

# 18. Multiple Users

Example:

```text
USER A
------
A-PC-01
A-PC-02
A-PC-03
```

```text
USER B
------
B-PC-01
B-PC-02
```

```text
USER C
------
C-PC-01
```

Database may contain all devices:

```text
A-PC-01 -> user_id A
A-PC-02 -> user_id A
A-PC-03 -> user_id A

B-PC-01 -> user_id B
B-PC-02 -> user_id B

C-PC-01 -> user_id C
```

But each user's API response must contain only their own devices.

---

# 19. Final Security Rule

The core rule is:

```text
AUTHENTICATED USER
       |
       v
USER ID
       |
       v
ONLY DEVICES WHERE
devices.user_id = USER ID
```

Never:

```text
All devices -> frontend filter
```

Always:

```text
Authentication
      |
      v
Authorization
      |
      v
Database ownership check
      |
      v
Return only authorized devices
```

---

# 20. Final VyomDesk Architecture

```text
                    VYOMDESK WEBSITE
                           |
              +------------+------------+
              |                         |
          REGISTER                    LOGIN
              |                         |
              +------------+------------+
                           |
                           v
                       DASHBOARD
                           |
                           v
                      ADD DEVICE
                           |
                           v
                Generate Installation Token
                           |
                           v
                  Download Agent (.exe)
                           |
                           v
                    CLIENT WINDOWS PC
                           |
                           v
                   VyomDesk Agent
                           |
                           v
                    Register Device
                           |
                           v
                 Validate Installation Token
                           |
                           v
                  Resolve User Ownership
                           |
                           v
                    Create Device
                           |
                           v
                 devices.user_id = user_id
                           |
                           v
                  Persistent Connection
                           |
                           v
                     HEARTBEAT
                           |
                           v
                    ONLINE / OFFLINE
                           |
                           v
                  USER DASHBOARD ONLY
```

---

# 21. Acceptance Criteria

Implementation is considered correct only when all of the following work:

### Registration

- [ ] User can register with name, email and password.
- [ ] Password is securely hashed.
- [ ] User can log in.
- [ ] Authenticated session/JWT works correctly.

### Agent Download

- [ ] Dashboard contains Add Device.
- [ ] Add Device generates a unique installation token.
- [ ] Agent `.exe` can be downloaded.
- [ ] Agent downloaded by User A is associated with User A.

### Device Registration

- [ ] Agent registers automatically after installation/start.
- [ ] Backend resolves the correct user from the installation token.
- [ ] Device is created with correct `user_id`.
- [ ] Installation token cannot be reused improperly.

### Dashboard

- [ ] User A sees only User A's devices.
- [ ] User B sees only User B's devices.
- [ ] Existing devices of other users are never displayed.
- [ ] Backend also enforces this restriction.

### Online Status

- [ ] Agent sends heartbeat/maintains connection.
- [ ] Online status is shown when connected.
- [ ] Offline status is shown after connection timeout.
- [ ] Agent reconnects automatically after temporary network failure.

### Windows Restart

- [ ] Agent starts automatically after Windows restart.
- [ ] Agent automatically authenticates.
- [ ] Agent automatically reconnects to the server.
- [ ] Device becomes online without manually opening the agent.

### Security

- [ ] Users cannot access another user's device by changing device ID.
- [ ] Device-specific APIs verify ownership.
- [ ] Installation tokens can expire/revoke.
- [ ] Communication uses HTTPS/WSS.
- [ ] Authentication credentials are stored securely.
- [ ] Frontend filtering is NOT the only security mechanism.

---

# 22. Important Implementation Note

The current VyomDesk project should be modified according to its existing architecture rather than replacing the entire project.

Before implementation:

1. Inspect frontend.
2. Inspect backend.
3. Inspect database/schema.
4. Inspect current agent registration process.
5. Identify current device APIs.
6. Identify why all users currently see all devices.
7. Implement user ownership and authorization.
8. Implement per-user installation tokens.
9. Implement agent auto-registration.
10. Test with at least two separate users and multiple client PCs.

## Required Final Test

Create:

```text
User A
User B
```

Install:

```text
User A Agent -> PC A
User A Agent -> PC A2

User B Agent -> PC B
User B Agent -> PC B2
```

Expected:

```text
User A Dashboard
----------------
PC A
PC A2
```

```text
User B Dashboard
----------------
PC B
PC B2
```

There must be no cross-user device visibility or access.
