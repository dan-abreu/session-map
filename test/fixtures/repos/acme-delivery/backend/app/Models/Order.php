<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

#[\AllowDynamicProperties]
class Order extends Model
{
    protected $fillable = ['total_cents'];

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }
}
