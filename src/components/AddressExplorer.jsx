import React, { useState, useEffect, useRef } from 'react';
import { Input, Card, Table, Typography, message, Select, Row, Col, Button, Collapse, Statistic } from 'antd';
import { SearchOutlined, WalletOutlined, EyeOutlined, EyeInvisibleOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import './AddressExplorer.css';
import Web3 from 'web3';
import axios from 'axios';

// 价格缓存时间（毫秒）
const CACHE_DURATION = 60000; // 1分钟
const RETRY_DELAY = 5000; // 5秒后重试
const MAX_RETRIES = 3; // 最大重试次数

const { Title } = Typography;

const AddressExplorer = () => {
  const [address, setAddress] = useState('');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chainType, setChainType] = useState('BTC');
  const [currency, setCurrency] = useState('CNY');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [btcPrice, setBtcPrice] = useState(0);
  const [ethPrice, setEthPrice] = useState(0);
  const [priceChanges, setPriceChanges] = useState({ btc: 0, eth: 0 });
  const defaultAddresses = [
    '38G6aG31AxVWAAdrkph3kjzoe4ZD3T9ZeR',
    'bc1pgwv4d0dw2y8pnnw9s8g25ksqktd8qyu3xpwa5f7y3pxeht40tdwsvz5kqe',
    '38ohx7Zzqmi5qJLMbBFptRrYdJycptCcS8'
  ];
  const [addressCards, setAddressCards] = useState([]);
  const [hiddenCards, setHiddenCards] = useState({
    '38ohx7Zzqmi5qJLMbBFptRrYdJycptCcS8': true // 默认隐藏的地址
  });

  const validateBitcoinAddress = (address) => {
    // 简单的比特币地址格式验证
    const regex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[ac-hj-np-z02-9]{11,71}$/;
    return regex.test(address);
  };

  const columns = [
    {
      title: '代币名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '代币符号',
      dataIndex: 'symbol',
      key: 'symbol',
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
    },
    {
      title: `价值 (${currency})`,
      dataIndex: 'value',
      key: 'value',
      render: (text) => currency === 'CNY' ? `¥${(text * exchangeRate).toFixed(2)}` : `$${text.toFixed(2)}`,
    },
  ];

  // 从Binance API获取价格
const fetchPriceFromBinance = async () => {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT"]');
    const btcData = response.data.find(item => item.symbol === 'BTCUSDT');
    const ethData = response.data.find(item => item.symbol === 'ETHUSDT');
    return {
      bitcoin: { usd: parseFloat(btcData.lastPrice), usd_24h_change: parseFloat(btcData.priceChangePercent) },
      ethereum: { usd: parseFloat(ethData.lastPrice), usd_24h_change: parseFloat(ethData.priceChangePercent) }
    };
  } catch (error) {
    throw new Error('Binance API请求失败');
  }
};

// 从OKX API获取价格
const fetchPriceFromOKX = async () => {
  try {
    const [btcResponse, ethResponse] = await Promise.all([
      axios.get('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT'),
      axios.get('https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT')
    ]);
    
    const btcData = btcResponse.data.data[0];
    const ethData = ethResponse.data.data[0];
    
    return {
      bitcoin: {
        usd: parseFloat(btcData.last),
        usd_24h_change: ((parseFloat(btcData.last) - parseFloat(btcData.open24h)) / parseFloat(btcData.open24h) * 100)
      },
      ethereum: {
        usd: parseFloat(ethData.last),
        usd_24h_change: ((parseFloat(ethData.last) - parseFloat(ethData.open24h)) / parseFloat(ethData.open24h) * 100)
      }
    };
  } catch (error) {
    throw new Error('OKX API请求失败');
  }
};

// 从备用API获取价格
const fetchPriceFromBackupAPI = async () => {
  try {
    return await fetchPriceFromBinance();
  } catch (binanceError) {
    console.log('Binance API失败，尝试OKX API...');
    try {
      return await fetchPriceFromOKX();
    } catch (okxError) {
      throw new Error('所有备用API请求均失败');
    }
  }
};

const updateCryptoPrices = async (retryCount = 0) => {
  try {
    let priceData;
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true');
      priceData = response.data;
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        message.warning('价格数据获取失败，正在重试...');
        setTimeout(() => updateCryptoPrices(retryCount + 1), RETRY_DELAY);
        return;
      }
      // 使用备用API
      message.info('正在使用备用数据源...');
      priceData = await fetchPriceFromBackupAPI();
    }

    const newBtcPrice = priceData.bitcoin.usd;
    const newEthPrice = priceData.ethereum.usd;
    const btcChange = priceData.bitcoin.usd_24h_change;
    const ethChange = priceData.ethereum.usd_24h_change;

    setBtcPrice(newBtcPrice);
    setEthPrice(newEthPrice);
    setPriceChanges({
      btc: btcChange,
      eth: ethChange
    });
    
    // 更新所有卡片的价值
    setAddressCards(prev => prev.map(card => ({
      ...card,
      value: card.balance * newBtcPrice
    })));

    // 更新本地缓存
    localStorage.setItem('cryptoPrices', JSON.stringify({
      timestamp: Date.now(),
      data: priceData
    }));
  } catch (error) {
    console.error('获取加密货币价格失败:', error);
    message.error('无法获取最新价格数据');
  }
  };

  const updatePricesInterval = useRef(null);

  useEffect(() => {
    // 尝试从本地缓存获取数据
    const cachedData = localStorage.getItem('cryptoPrices');
    if (cachedData) {
      const { timestamp, data } = JSON.parse(cachedData);
      if (Date.now() - timestamp < CACHE_DURATION) {
        // 使用缓存数据
        const { bitcoin, ethereum } = data;
        setBtcPrice(bitcoin.usd);
        setEthPrice(ethereum.usd);
        setPriceChanges({
          btc: bitcoin.usd_24h_change,
          eth: ethereum.usd_24h_change
        });
      }
    }

    // 初始化时获取价格
    updateCryptoPrices();

    // 设置定时更新
    updatePricesInterval.current = setInterval(updateCryptoPrices, CACHE_DURATION);

    return () => {
      if (updatePricesInterval.current) {
        clearInterval(updatePricesInterval.current);
      }
    };
  }, []);

  const updateBTCPrice = async () => {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const newPrice = response.data.bitcoin.usd;
      setBtcPrice(newPrice);
      
      // 更新所有卡片的价值
      setAddressCards(prev => prev.map(card => ({
        ...card,
        value: card.balance * newPrice
      })));
    } catch (error) {
      console.error('获取BTC价格失败:', error);
    }
  };

  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
        setExchangeRate(response.data.rates.CNY);
      } catch (error) {
        console.error('获取汇率失败:', error);
      }
    };
    fetchExchangeRate();

    // 只在组件加载时获取一次BTC价格
    updateBTCPrice();
  }, []);

  useEffect(() => {
    // 初始化时加载默认地址的信息
    defaultAddresses.forEach(addr => {
      handleSearch(addr, true);
    });
  }, []);

  const handleSearch = async (searchAddress = address, isCard = false) => {
    const targetAddress = searchAddress || address;
    if (chainType === 'ETH' && !Web3.utils.isAddress(targetAddress)) {
      message.error('请输入有效的以太坊地址');
      return;
    } else if (chainType === 'BTC' && !validateBitcoinAddress(targetAddress)) {
      message.error('请输入有效的比特币地址');
      return;
    }

    setLoading(true);
    try {
      let tokenList = [];
      
      if (chainType === 'ETH') {
        // 使用Etherscan API获取以太坊代币余额
        const response = await axios.get(
          `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&sort=desc&apikey=YourApiKey`
        );

        if (response.data.status === '1') {
          const tokenData = response.data.result;
          const uniqueTokens = new Set();

          for (const tx of tokenData) {
            if (!uniqueTokens.has(tx.contractAddress)) {
              uniqueTokens.add(tx.contractAddress);
              tokenList.push({
                key: tx.contractAddress,
                name: tx.tokenName,
                symbol: tx.tokenSymbol,
                balance: tx.value / Math.pow(10, tx.tokenDecimal),
                value: 0,
              });
            }
          }
        }
      } else if (chainType === 'BTC') {
        // 使用mempool.space API获取比特币余额
        try {
          const response = await axios.get(
            `https://mempool.space/api/address/${targetAddress}`
          );

          const btcBalance = (response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum) / 100000000;
          const btcValue = btcBalance * btcPrice;
          tokenList.push({
            key: 'btc',
            name: 'Bitcoin',
            symbol: 'BTC',
            balance: btcBalance,
            value: btcValue,
          });
        } catch (error) {
          // 如果mempool.space API失败，尝试使用blockchain.com API作为备选
          try {
            const response = await axios.get(
              `https://blockchain.info/balance?active=${targetAddress}`
            );

            const btcBalance = response.data[targetAddress].final_balance / 100000000;
            const btcValue = btcBalance * btcPrice;
            tokenList.push({
              key: 'btc',
              name: 'Bitcoin',
              symbol: 'BTC',
              balance: btcBalance,
              value: btcValue,
            });
          } catch (backupError) {
            throw new Error('所有可用的API都无法访问，请稍后重试');
          }
        }
      }

      // 获取实时价格数据
      if (tokenList.length > 0) {
        try {
          if (chainType === 'ETH') {
            const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
            const ethPrice = priceResponse.data.ethereum.usd;
            tokenList = await Promise.all(tokenList.map(async (token) => {
              try {
                const tokenPriceResponse = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${token.key}&vs_currencies=usd`);
                const tokenPrice = tokenPriceResponse.data[token.key.toLowerCase()]?.usd || 0;
                return { ...token, value: token.balance * tokenPrice };
              } catch {
                return { ...token, value: 0 };
              }
            }));
          } else if (chainType === 'BTC') {
            const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
            const btcPrice = priceResponse.data.bitcoin.usd;
            tokenList[0].value = tokenList[0].balance * btcPrice;
          }
        } catch (priceError) {
          console.error('获取价格数据失败:', priceError);
        }
      }

      if (isCard) {
        setAddressCards(prev => {
          // 创建一个新的卡片数据
          const cardData = {
            address: targetAddress,
            balance: tokenList[0].balance,
            value: tokenList[0].value
          };
          
          // 创建一个新的卡片数组，保持与defaultAddresses相同的顺序
          const newCards = defaultAddresses.map(addr => {
            // 如果是当前更新的地址，使用新数据
            if (addr === targetAddress) {
              return cardData;
            }
            // 否则使用现有数据或创建空数据
            const existingCard = prev.find(card => card.address === addr);
            return existingCard || { address: addr, balance: 0, value: 0 };
          });
          
          return newCards;
        });
      } else {
        setTokens(tokenList);
      }
    } catch (error) {
      message.error('获取数据失败，请稍后重试');
      console.error(error);
    }
    setLoading(false);
  };

  return (
    <div className="address-explorer">
      <Title level={2}>加密货币地址浏览器</Title>
      <Row gutter={[8, 8]} className="price-cards">
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '12px' }}>
            <Statistic
              title="BTC 价格"
              value={btcPrice}
              precision={2}
              prefix="$"
              suffix="USD"
              valueStyle={{ color: priceChanges.btc >= 0 ? '#3f8600' : '#cf1322' }}
            />
            <div className="price-change">
              24h: {priceChanges.btc.toFixed(2)}%
              {priceChanges.btc >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '12px' }}>
            <Statistic
              title="ETH 价格"
              value={ethPrice}
              precision={2}
              prefix="$"
              suffix="USD"
              valueStyle={{ color: priceChanges.eth >= 0 ? '#3f8600' : '#cf1322' }}
            />
            <div className="price-change">
              24h: {priceChanges.eth.toFixed(2)}%
              {priceChanges.eth >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '12px' }}>
            <Statistic
              title="ETH/BTC 比率"
              value={ethPrice / btcPrice}
              precision={4}
              valueStyle={{ color: '#1890ff' }}
            />
            <div className="price-change">
              1 ETH = {(ethPrice / btcPrice).toFixed(4)} BTC
            </div>
          </Card>
        </Col>
      </Row>
      <Row justify="center" style={{ marginBottom: '24px' }}>
        <Col span={24}>
          <Card>
            <Statistic
              title="指定地址总金额"
              value={
                addressCards
                  .filter(card => 
                    card.address === '38G6aG31AxVWAAdrkph3kjzoe4ZD3T9ZeR' || 
                    card.address === 'bc1pgwv4d0dw2y8pnnw9s8g25ksqktd8qyu3xpwa5f7y3pxeht40tdwsvz5kqe'
                  )
                  .reduce((sum, card) => sum + (currency === 'USD' ? card.value : card.value * exchangeRate), 0)
              }
              precision={2}
              prefix={currency === 'USD' ? '$' : '¥'}
              valueStyle={{ color: '#1890ff', fontSize: '24px' }}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        {addressCards.map((card, index) => (
          <Col xs={24} sm={12} md={8} key={card.address}>
            <Card
              className={`address-card ${hiddenCards[card.address] ? 'collapsed' : ''}`}
              title={<span><WalletOutlined /> 比特币地址</span>}
              extra={<div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  type="text"
                  icon={hiddenCards[card.address] ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                  onClick={() => setHiddenCards(prev => ({ ...prev, [card.address]: !prev[card.address] }))}
                />
                <a href={`https://www.blockchain.com/explorer/addresses/btc/${card.address}`} target="_blank" rel="noopener noreferrer">查看详情</a>
              </div>}
            >
              <div className="card-content">
                <p style={{ wordBreak: 'break-all' }}>{card.address}</p>
                <p>余额: {card.balance.toFixed(8)} BTC</p>
                <p style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  价值: {currency === 'USD' ? `$${card.value.toFixed(2)}` : `¥${(card.value * exchangeRate).toFixed(2)}`}
                </p>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
      <Card>
        <div style={{ display: 'flex', marginBottom: '24px', gap: '16px' }}></div>
          <Select
            value={chainType}
            onChange={setChainType}
            style={{ width: 120 }}
            options={[
              { value: 'ETH', label: '以太坊' },
              { value: 'BTC', label: '比特币' },
            ]}
          />
          <Select
            value={currency}
            onChange={setCurrency}
            style={{ width: 120 }}
            options={[
              { value: 'USD', label: '美元 (USD)' },
              { value: 'CNY', label: '人民币 (CNY)' },
            ]}
          />
          <Input.Search
            placeholder={`请输入${chainType === 'ETH' ? '以太坊' : '比特币'}地址`}
            style={{ flex: 1 }}
          enterButton={<SearchOutlined />}
          size="large"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onSearch={handleSearch}

        />
        <Table
          columns={columns}
          dataSource={tokens}
          loading={loading}
          pagination={false}
        />
      </Card>
    </div>
  );
};

export default AddressExplorer;