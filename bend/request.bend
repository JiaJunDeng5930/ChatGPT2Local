import Base
import ./request-domain.bend as D

def messages(parent: D.Parent) -> D.Admission:
  match parent:
    case D.Root{}: D.NewPage{}
    case D.Calls{}: D.Denied{D.ResultsRequired{}}
    case D.Answered{}: D.Append{}
    case D.Missing{}: D.Denied{D.PreviousMissing{}}
    case D.Pending{}: D.Denied{D.PreviousPending{}}
    case D.Claimed{}: D.Denied{D.PreviousConsumed{}}
    case D.Unavailable{}: D.Denied{D.PreviousUnavailable{}}

def results(parent: D.Parent) -> D.Admission:
  match parent:
    case D.Root{}: D.Denied{D.MessagesRequired{}}
    case D.Calls{}: D.DeliverResults{}
    case D.Answered{}: D.Denied{D.MessagesRequired{}}
    case D.Missing{}: D.Denied{D.PreviousMissing{}}
    case D.Pending{}: D.Denied{D.PreviousPending{}}
    case D.Claimed{}: D.Denied{D.PreviousConsumed{}}
    case D.Unavailable{}: D.Denied{D.PreviousUnavailable{}}

def decide(key: D.Key, parent: D.Parent, input: D.Input) -> D.Admission:
  match key:
    case D.RepeatedKey{}: D.Replay{}
    case D.ConflictingKey{}: D.Denied{D.KeyConflict{}}
    case D.FreshKey{}:
      match input:
        case D.Messages{}: messages(parent)
        case D.Results{}: results(parent)
