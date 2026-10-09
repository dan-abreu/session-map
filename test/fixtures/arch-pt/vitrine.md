# Vitrine

> **Versão:** 1.0
> **Tipo:** documento constitucional.

A vitrine é o site onde o cliente vê os produtores da semana, monta a cesta e faz o pedido. Não guarda dados de pagamento.

## Como funciona

1. O cliente abre a vitrine e escolhe o bairro.
2. A vitrine mostra só os produtores que entregam ali.

```ts
// Isto não é uma seção:
## O que falta
```

## Onde está no código

| Peça           | Onde                                  | O que faz              |
| -------------- | ------------------------------------- | ---------------------- |
| Páginas        | [`apps/site/src/paginas/`](../../apps/site/src/paginas) | Telas da vitrine |
| Filtro         | `packages/core/src/filtro-de-bairro.ts` | Escolhe os produtores |
| Comando solto  | `pnpm dev` (sem barra)                | Não conta como caminho |

## O que falta

Seção viva: muda toda vez que um item nasce ou fecha. 4 itens em aberto: 1 bloqueia o lançamento, 1 importante, 1 detalhe, 1 sem peso (vale a etapa do roteiro).

### Geral

- [ ] **em andamento · Ana e Claude · etapa 5 do roteiro:** Fotos reais dos produtores `vi01`
  - Falta tratar as fotos grandes.
  - Precisa de autorização por escrito.
- [ ] **com o Marcos · bloqueia:** Aprovar o texto do aviso de cookies `vi02`
- [x] **Claude:** Página de erro amigável `vi03`

### Busca

- [ ] **importante:** Busca por nome de produtor `vi04`
- [ ] **Atenção:** Ajustar o `rodapé` com o logo novo `vi05`
- [ ] Trocar a cor do botão **principal** `vi06` e depois conferir
- [ ] **detalhe:** Texto do vazio da busca `vi07`
