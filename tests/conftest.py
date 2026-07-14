from pathlib import Path

import pytest
from openhost_test_harness import OpenhostStack


def _deploy_mock_health(stack: OpenhostStack) -> None:
    """Deploy the synthetic health-data provider elevate consumes (see mock_health_provider/)."""
    provider_dir = Path(__file__).resolve().parent / "mock_health_provider"
    stack.deploy_app(f"file://{provider_dir}")


@pytest.fixture(scope="session")
def stack():
    with OpenhostStack(
        app_dir=Path(__file__).resolve().parent.parent,
        pre_deploy=_deploy_mock_health,
    ) as s:
        yield s
