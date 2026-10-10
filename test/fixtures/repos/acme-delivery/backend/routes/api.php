<?php

use App\Http\Controllers\OrderController;
use App\Models\Order;
use Illuminate\Support\Facades\Route;

# Route::get('/ghost-hash', fn () => 'dropped before v1');

Route::get('/ping', fn () => ['ok' => true]);
Route::post('/feedback', fn () => response()->noContent());
Route::get('/stats', fn () => ['orders' => Order::count()]);

Route::prefix('v1')->group(function () {
    Route::get('/menu', [OrderController::class, 'menu']);
    Route::apiResource('orders', OrderController::class);
});

$help = <<<TEXT
Route::get('/ghost-heredoc', fn () => 'never registered');
TEXT;
