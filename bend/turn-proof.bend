import Base
import ./domain.bend as D
import ./LAWS.bend as L

def L.turn_refinement(s, e):
  match s:
    case D.Fresh{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Prepared{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Attempted{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Running{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Unknown{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Completed{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Cancelled{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}

def L.send_allowance(s, e):
  match s:
    case D.Fresh{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Prepared{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Attempted{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Running{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Unknown{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Completed{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Cancelled{}:
      match e:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}

def L.uncertainty_never_sends(s):
  match s:
    case D.Fresh{}: {==}
    case D.Prepared{}: {==}
    case D.Attempted{}: {==}
    case D.Running{}: {==}
    case D.Unknown{}: {==}
    case D.Completed{}: {==}
    case D.Cancelled{}: {==}

def L.uncertainty_never_stops(s):
  match s:
    case D.Fresh{}: {==}
    case D.Prepared{}: {==}
    case D.Attempted{}: {==}
    case D.Running{}: {==}
    case D.Unknown{}: {==}
    case D.Completed{}: {==}
    case D.Cancelled{}: {==}

def L.detach_is_not_cancel(s):
  match s:
    case D.Fresh{}: {==}
    case D.Prepared{}: {==}
    case D.Attempted{}: {==}
    case D.Running{}: {==}
    case D.Unknown{}: {==}
    case D.Completed{}: {==}
    case D.Cancelled{}: {==}

def L.recovery_is_observation(s):
  match s:
    case D.Fresh{}: {==}
    case D.Prepared{}: {==}
    case D.Attempted{}: {==}
    case D.Running{}: {==}
    case D.Unknown{}: {==}
    case D.Completed{}: {==}
    case D.Cancelled{}: {==}

def L.recovery_is_idempotent(s):
  match s:
    case D.Fresh{}: {==}
    case D.Prepared{}: {==}
    case D.Attempted{}: {==}
    case D.Running{}: {==}
    case D.Unknown{}: {==}
    case D.Completed{}: {==}
    case D.Cancelled{}: {==}
