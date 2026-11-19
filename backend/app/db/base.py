from sqlalchemy import BigInteger, DateTime
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import DeclarativeBase

# BIGINT UNSIGNED on MySQL, plain BigInteger elsewhere.
BigID = BigInteger().with_variant(mysql.BIGINT(unsigned=True), "mysql")


class Base(DeclarativeBase):
    pass

# Millisecond-precision DATETIME(3) on MySQL.
DateTime3 = DateTime().with_variant(mysql.DATETIME(fsp=3), "mysql")
