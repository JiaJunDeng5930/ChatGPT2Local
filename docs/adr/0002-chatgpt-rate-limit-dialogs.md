# Coordinate ChatGPT rate-limit dismissal and submission evidence

Status: Accepted

Rate-limit dialogs can appear while browser automation is preparing a message, submitting it,
or observing a response. Dismissal must not wait for the current Playwright operation, but removing
the dialog must not erase evidence of a rejected request. Keyboard acknowledgement also races with
the composer's focus and can activate the wrong control.

Use one self-contained installer for the Electron preload and Playwright page initialization.
Keep the installation marker, notice revision, consumed revision, and closing state in the DOM:
Electron's isolated preload and the page do not share JavaScript globals. Record each known
frequency notice before clicking its acknowledgement button. Click once per visible occurrence,
track removal or reuse, and bound waiting for the close operation. Do not dismiss arbitrary dialogs
or restore focus from the observer.

An explicitly new request retires notices that were already closed before preparation. Notices
discovered during installation and still-visible dialogs remain actionable. Reconnecting the same
page preserves this evidence. Preparation interrupted by a new notice fails with a non-retryable
rate-limit error; closing a notification does not prove that a server cooldown has ended.

Inspect and click the send button in one JavaScript task, checking pending notices and control
availability first. Retry only a local control check that explicitly reports it did not click.
Keep the host's send-activation notification before activation, and retain the existing ambiguous
submission failure behavior for exceptions or transport loss. Do not replay attachments or send
again to recover from a dialog.

After activation, prefer observed submission acceptance over a concurrent notice, including a fresh
observation after waiting for dismissal. Once submission is accepted, dismiss subsequent notices
while continuing to read the response. Actual request rejection remains the responsibility of the
existing submission rejection observer. This separates UI obstruction from server acceptance
without treating either an absent dialog or a successful click as proof of delivery.
