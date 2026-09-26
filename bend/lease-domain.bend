import Base

# An observer leaving a page does not tell us that its computation has stopped.
# The launcher owns physical surfaces; this decision only changes their lease.
type Report is Data:
  Completed{}
  Uncertain{}
  UserCancelled{}

type Status is Data:
  Ready{}
  Unknown{}
  Cancelled{}

type Decision is Data:
  Decision{status: Status, reusable: Bool, protect: Bool}

type Admission is Data:
  Reattach{}
  OwnerBusy{}
  OwnerUnknown{}

def reusable(d: Decision) -> Bool:
  match d:
    case Decision{s, r, p}: r

def protect(d: Decision) -> Bool:
  match d:
    case Decision{s, r, p}: p
