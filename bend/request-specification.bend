import Base
import ./request-domain.bend as D

# Independent meaning of the two public operations. A repeated request remains
# a replay even after its predecessor was consumed or its page was lost.
def fresh(parent: D.Parent, input: D.Input) -> D.Admission:
  match parent input:
    case D.Root{} D.Messages{}: D.NewPage{}
    case D.Root{} D.Results{}: D.Denied{D.MessagesRequired{}}
    case D.Calls{} D.Messages{}: D.Denied{D.ResultsRequired{}}
    case D.Calls{} D.Results{}: D.DeliverResults{}
    case D.Answered{} D.Messages{}: D.Append{}
    case D.Answered{} D.Results{}: D.Denied{D.MessagesRequired{}}
    case D.Missing{} _: D.Denied{D.PreviousMissing{}}
    case D.Pending{} _: D.Denied{D.PreviousPending{}}
    case D.Claimed{} _: D.Denied{D.PreviousConsumed{}}
    case D.Unavailable{} _: D.Denied{D.PreviousUnavailable{}}

def decide(key: D.Key, parent: D.Parent, input: D.Input) -> D.Admission:
  match key:
    case D.FreshKey{}: fresh(parent, input)
    case D.RepeatedKey{}: D.Replay{}
    case D.ConflictingKey{}: D.Denied{D.KeyConflict{}}
