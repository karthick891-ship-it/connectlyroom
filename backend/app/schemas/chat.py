from typing import Literal

from pydantic import BaseModel, Field, model_validator


class CreateConversationIn(BaseModel):
    type: Literal["direct", "group"]
    user_id: int | None = None  # direct
    name: str | None = Field(default=None, max_length=100)  # group
    member_ids: list[int] = Field(default_factory=list, max_length=200)  # group

    @model_validator(mode="after")
    def check(self):
        if self.type == "direct" and not self.user_id:
            raise ValueError("user_id is required for direct conversations")
        if self.type == "group":
            if not self.name or not self.name.strip():
                raise ValueError("name is required for group conversations")
            if not self.member_ids:
                raise ValueError("member_ids must contain at least one user")
        return self
