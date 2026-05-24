from app.experiment_registry import ExperimentRegistry


def test_registry_lists_all_eight_experiments() -> None:
    registry = ExperimentRegistry()
    experiments = registry.list(include_unknown=True)
    assert {experiment.experiment_id for experiment in experiments} == {
        "ex_1",
        "ex_4",
        "ex_9",
        "ex_20",
        "ex_21",
        "ex_22",
        "ex_23",
        "ex_24",
    }
    assert all(experiment.sample_count > 0 for experiment in experiments)
    assert all(experiment.voltage_column == "input_voltage" for experiment in experiments)


def test_registry_filters_by_split_and_mode() -> None:
    registry = ExperimentRegistry()
    test_experiments = registry.list(split="test", include_unknown=True)
    continuous = registry.list(mode="continuous", include_unknown=True)
    assert {experiment.experiment_id for experiment in test_experiments} == {"ex_4", "ex_22"}
    assert any(experiment.experiment_id == "ex_22" for experiment in continuous)

