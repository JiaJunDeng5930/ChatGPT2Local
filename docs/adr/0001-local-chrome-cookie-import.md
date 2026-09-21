# Read local Chrome cookies on macOS

Status: Accepted

The launcher offers explicit sign-in from an existing local Chrome profile in automatic browser
mode. Chrome restricts remote debugging of its default user-data directory, so attaching CDP would
not reliably provide the user's existing session. Read the selected profile's cookie database
without modifying it and decrypt applicable cookies through macOS Keychain instead.

Profile enumeration and decryption run only in the Electron main process. Renderer IPC carries
profile identifiers, display names, and completion state, never cookie values or encryption secrets.
The imported storage state reuses the session transfer lifecycle shared with passkey login, including
exclusive browser ownership and server authentication verification. Failed imports clear partial
state and attempt to restore prior cookies and ChatGPT local storage. Only macOS is supported.
