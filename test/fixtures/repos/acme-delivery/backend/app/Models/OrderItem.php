<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    protected $fillable = ['name'];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}
