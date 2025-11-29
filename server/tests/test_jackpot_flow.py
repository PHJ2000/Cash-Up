from datetime import datetime

import app.main as main
from app.db import Base
from app.models import Festival, JackpotEntry, JackpotPool, JackpotWinner, User, UserDailySummary
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker


def test_draw_jackpot_with_mocked_entries(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path}/jackpot.db",
        connect_args={"check_same_thread": False},
        future=True,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        festival = Festival(
            id="fest-1",
            name="테스트 축제",
            budget=1_000_000,
            per_user_daily_cap=500_000,
            per_photo_point=1_000,
        )
        alice = User(id="user-a", provider="mock", provider_user_id="alice", display_name="앨리스")
        bob = User(id="user-b", provider="mock", provider_user_id="bob", display_name="밥")
        pool = JackpotPool(festival_id=festival.id, current_amount=50_000, seed_amount=10_000)

        now_kst = datetime.now(main.KST)
        week_key = f"{now_kst.year}-W{now_kst.isocalendar()[1]:02d}"
        entries = [
            JackpotEntry(user_id=alice.id, festival_id=festival.id, week_key=week_key, entry_count=1),
            JackpotEntry(user_id=bob.id, festival_id=festival.id, week_key=week_key, entry_count=3),
        ]

        db.add_all([festival, alice, bob, pool, *entries])
        db.commit()

        # 주차별 누적 금액 조회가 기대대로 동작하는지 확인
        jackpot_before = main.get_jackpot(festival.id, db=db)
        assert jackpot_before["current_amount"] == 50_000
        assert jackpot_before["last_winner_name"] is None

        # 추첨 결과를 예측 가능하게 만들기 위해 choices를 목킹
        def pick_bob(users, weights, k=1):
            assert users == [alice.id, bob.id]
            assert weights == [1, 3]
            return [bob.id]

        monkeypatch.setattr(main.random, "choices", pick_bob)
        monkeypatch.setattr(main, "ADMIN_TOKEN", "test-admin-token")

        result = main.draw_jackpot(festival.id, x_admin_token="test-admin-token", db=db)

        # 풀은 0으로 리셋되고, 당첨자는 가중치에 따라 밥으로 고정된다.
        db.refresh(pool)
        assert pool.current_amount == 0
        assert pool.last_winner_id == bob.id
        assert result["winner_name"] == bob.display_name
        assert result["amount"] == 50_000

        summary = (
            db.execute(
                select(UserDailySummary).where(
                    UserDailySummary.user_id == bob.id,
                    UserDailySummary.festival_id == festival.id,
                    UserDailySummary.date == now_kst.strftime("%Y-%m-%d"),
                )
            )
            .scalars()
            .one()
        )
        assert summary.total_active == 50_000

        winner_record = (
            db.execute(select(JackpotWinner).where(JackpotWinner.user_id == bob.id, JackpotWinner.week_key == week_key))
            .scalars()
            .one()
        )
        assert winner_record.amount == 50_000


def test_jackpot_pool_normalizes_without_demo_login(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path}/jackpot.db",
        connect_args={"check_same_thread": False},
        future=True,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        festival = Festival(
            id="fest-2",
            name="테스트 축제2",
            budget=1_000_000,
            per_user_daily_cap=500_000,
            per_photo_point=1_000,
        )
        user = User(id="user-c", provider="mock", provider_user_id="charlie", display_name="찰리")
        db.add_all([festival, user])
        db.commit()

        # 환경값을 강제로 세팅해도, ensure_jackpot_pool가 현재 풀을 자동으로 프라임하는지 확인
        monkeypatch.setattr(main, "DEMO_JACKPOT_FESTIVAL_ID", festival.id)
        monkeypatch.setattr(main, "DEMO_JACKPOT_SEED", 10_000)
        monkeypatch.setattr(main, "DEMO_JACKPOT_TARGET", 100_000)
        monkeypatch.setattr(main, "DEMO_JACKPOT_START_PERCENT", 0.78)
        monkeypatch.setattr(main, "DEMO_JACKPOT_CONTRIBUTION_RATE", 1.0)

        pool = main.ensure_jackpot_pool(db, festival, user)
        assert pool.seed_amount == 10_000
        assert pool.contribution_rate == 1.0
        # target_amount = max(10_000, 100_000 * 0.78) = 78_000
        assert pool.current_amount == 78_000

        # 두 번째 호출 시 이미 프라임된 상태이므로 값이 유지된다.
        pool_again = main.ensure_jackpot_pool(db, festival, user)
        assert pool_again.current_amount == 78_000
