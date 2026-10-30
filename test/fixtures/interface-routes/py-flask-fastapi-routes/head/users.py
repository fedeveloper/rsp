from fastapi import APIRouter

router = APIRouter()


@router.get("/users/{user_id:int}")
async def get_user(user_id: int):
    return {}
