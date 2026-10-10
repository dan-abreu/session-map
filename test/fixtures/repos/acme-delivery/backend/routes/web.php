<?php

use Illuminate\Support\Facades\Route;

Route::get('/receipt/{order}', fn ($order) => view('receipt', ['order' => $order]));
