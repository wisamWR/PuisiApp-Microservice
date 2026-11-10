# RabbitMQ 4.1 + plugin delayed message exchange (dipakai exchange retry.delayed)
# dan plugin Prometheus (metrik untuk observability, T0.8).
# Versi plugin harus cocok dengan seri RabbitMQ (4.1.x -> plugin 4.1.x).
FROM rabbitmq:4.1.8-management

ARG DMX_VERSION=4.1.0
ADD --chmod=644 \
    https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v${DMX_VERSION}/rabbitmq_delayed_message_exchange-${DMX_VERSION}.ez \
    /opt/rabbitmq/plugins/

RUN rabbitmq-plugins enable --offline \
      rabbitmq_management \
      rabbitmq_prometheus \
      rabbitmq_delayed_message_exchange
