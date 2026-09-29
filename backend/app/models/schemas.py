from pydantic import BaseModel

class TranscribeResponse(BaseModel):
    lrc: str
    segments: list