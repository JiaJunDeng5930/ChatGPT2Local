# Dismiss ChatGPT rate-limit dialogs as UI blockers

Status: Accepted

The “Too many requests” dialog is a UI obstruction. Its presence or successful dismissal does
not establish whether the current request was accepted or rejected, so dismissing it must not
create a local rate-limit error or replace another failure. The normal submission evidence
decides the outcome: observed acceptance continues through response reading, while an actual
request rejection remains the responsibility of the submission rejection observer.

Use one self-contained installer for the Electron preload and Playwright page initialization.
The isolated Electron preload and the page share only the DOM, so retain the installation marker,
scan event, and pending state there. The observer recognizes only the configured dialog titles,
clicks an acknowledgement button at most once per visible occurrence, tracks removal or reuse,
and schedules scans for at most two seconds to cover close animations and delayed buttons. DOM
mutations continue to trigger scans after that interval. Do not dismiss arbitrary dialogs or
restore focus from the observer.

Inspect and click the send button in one JavaScript task. If the shared pending state is true,
return the existing unavailable result, which proves that this evaluation did not click; retry
only this bounded local control check. Once a click occurs, never activate Send again to recover
from the dialog. Keep the host's send-activation notification before activation and preserve the
existing ambiguous submission behavior for exceptions or transport loss. Do not replay
attachments or change actual upstream rejection handling.
