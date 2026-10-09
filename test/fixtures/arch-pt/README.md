# As partes da Feira Digital

> **Versão:** 1.0
> **Tipo:** documento constitucional.

A Feira Digital vista pelas partes do produto, um arquivo por parte. Cada arquivo termina com a seção **"O que falta"**.

## O mapa

```mermaid
flowchart LR
    subgraph entrada["Por onde as pessoas entram"]
        VIT[Vitrine]
        APP[App do entregador]
    end
    subgraph motor["O que faz funcionar"]
        CES[Cesta e pedidos]
        PAG[Pagamentos]
    end
    subgraph base["O que sustenta"]
        SEG[Segurança]
    end
    VIT --> CES
    CES --> PAG
    APP --> CES
```

## As partes

| Parte                              | Em uma linha                                  |
| ---------------------------------- | --------------------------------------------- |
| [Vitrine](vitrine.md)              | O site onde o cliente escolhe os produtos.    |
| [App do entregador](app-do-entregador.md) | Rotas e entregas do dia.               |
