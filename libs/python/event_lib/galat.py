class GalatPermanen(Exception):
    """Galat yang tidak akan berhasil meski dicoba ulang; langsung dipindah ke DLQ."""

    permanen = True


def apakah_permanen(err: BaseException) -> bool:
    return bool(getattr(err, "permanen", False))
