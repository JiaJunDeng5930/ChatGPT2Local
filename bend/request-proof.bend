import Base
import ./request-domain.bend as D
import ./request.bend as K
import ./request-specification.bend as S
import ./request-laws.bend as L

def L.admission_refinement(key, parent, input):
  match key parent input:
    case D.RepeatedKey{} _ _: {==}
    case D.ConflictingKey{} _ _: {==}
    case D.FreshKey{} D.Root{} D.Messages{}: {==}
    case D.FreshKey{} D.Root{} D.Results{}: {==}
    case D.FreshKey{} D.Calls{} D.Messages{}: {==}
    case D.FreshKey{} D.Calls{} D.Results{}: {==}
    case D.FreshKey{} D.Answered{} D.Messages{}: {==}
    case D.FreshKey{} D.Answered{} D.Results{}: {==}
    case D.FreshKey{} D.Missing{} D.Messages{}: {==}
    case D.FreshKey{} D.Missing{} D.Results{}: {==}
    case D.FreshKey{} D.Pending{} D.Messages{}: {==}
    case D.FreshKey{} D.Pending{} D.Results{}: {==}
    case D.FreshKey{} D.Claimed{} D.Messages{}: {==}
    case D.FreshKey{} D.Claimed{} D.Results{}: {==}
    case D.FreshKey{} D.Unavailable{} D.Messages{}: {==}
    case D.FreshKey{} D.Unavailable{} D.Results{}: {==}

def L.retry_replays(parent, input): {==}

def L.consumed_predecessor_rejects(input):
  match input:
    case D.Messages{}: {==}
    case D.Results{}: {==}
