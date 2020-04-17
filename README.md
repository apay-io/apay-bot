## Description

Apay bot is a simple implementation of balanced trading strategy for Stellar network.
It's inspired by uniswap protocol and doesn't require external source of rates to trade.

## Installation

Install docker for your OS

## Running the bot locally

```bash
$ cp .env.example .env
$ cp markets.json.example config/markets.json
$ docker-compose up
```

## Deploy to kubernetes cluster

k8s setup currently uses 1 deployment for the bot itself 
and 1 service (load balancer) to make bot manager 
API accessible from the outside.

I'm using external DB and Redis clusters. 

```bash
$ cp .env prod.env
```

Make sure to change values in prod.env to production

```bash
$ kubectl create secret generic apay-bot-secrets --from-env-file=prod.env
$ kubectl create configmap apay-bot-config --from-file=config
$ kubectl apply -f kube.yaml
$ kubectl apply -f kube-svc.yaml
```

## Stay in touch

- Telegram - [Papaya Feedback](https://t.me/PapayaFeedback)
- Keybase - [Apay](https://keybase.io/team/apay.public)

## License

  [MIT licensed](LICENSE).
