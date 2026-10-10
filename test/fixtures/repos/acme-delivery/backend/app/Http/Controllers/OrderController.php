<?php

namespace App\Http\Controllers;

use App\Jobs\SendReceipt;
use App\Models\Order;

class OrderController
{
    public function index()
    {
        return Order::with('items')->get();
    }

    public function store()
    {
        $order = Order::create(['total_cents' => 0]);
        SendReceipt::dispatch($order);

        return $order;
    }

    public function show(Order $order)
    {
        return $this->summary($order);
    }

    public function update(Order $order)
    {
        $order->touch();

        return $order;
    }

    public function destroy(Order $order)
    {
        $order->delete();

        return response()->noContent();
    }

    public function menu()
    {
        return [['name' => 'Soup', 'cents' => 590]];
    }

    private function summary(Order $order)
    {
        return $order->load('items');
    }
}
