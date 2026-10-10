<?php

namespace App\Jobs;

use App\Models\Order;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;

class SendReceipt implements ShouldQueue
{
    use Queueable;

    public function __construct(public Order $order)
    {
        $this->onQueue('mail');
    }

    public function handle(): void
    {
        // A retry used to call Http::get('https://ghost.example/status') here.
        Http::post('https://mail.acme-delivery.example/send', ['order' => $this->order->id]);
    }
}
