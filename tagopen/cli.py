"""CLI entry point."""

import asyncio
import logging

import structlog


def main() -> None:
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
    )

    from tagopen.llm import configure
    from tagopen.gateway.app import start

    configure()
    asyncio.run(start())


if __name__ == "__main__":
    main()
