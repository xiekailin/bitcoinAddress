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
    // 改进的比特币地址格式验证
    // 支持P2PKH (1开头)、P2SH (3开头)、Bech32 (bc1开头)和Taproot (bc1p开头)地址
    const legacyRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    const segwitRegex = /^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,71}$/;
    const taprootRegex = /^bc1p[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,71}$/;
    
    return legacyRegex.test(address) || segwitRegex.test(address) || taprootRegex.test(address);
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
        console.log('尝试从CoinGecko获取价格数据...');
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true', {
          timeout: 10000 // 增加超时时间到10秒
        });
        priceData = response.data;
        console.log('CoinGecko价格数据获取成功');
      } catch (error) {
        console.log('CoinGecko API失败:', error.message);
        if (retryCount < MAX_RETRIES) {
          message.warning('价格数据获取失败，正在重试...');
          setTimeout(() => updateCryptoPrices(retryCount + 1), RETRY_DELAY);
          return;
        }
        // 使用备用API
        message.info('正在使用备用数据源...');
        try {
          priceData = await fetchPriceFromBackupAPI();
          console.log('备用API价格数据获取成功');
        } catch (backupError) {
          console.error('所有价格API都失败了:', backupError.message);
          message.error('无法获取价格数据，请稍后刷新页面');
          return;
        }
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
    if (!targetAddress) {
      message.error('请输入地址');
      return;
    }
    
    // 验证地址格式
    if (chainType === 'ETH' && !Web3.utils.isAddress(targetAddress)) {
      message.error('请输入有效的以太坊地址');
      return;
    } else if (chainType === 'BTC' && !validateBitcoinAddress(targetAddress)) {
      message.error('请输入有效的比特币地址');
      return;
    }

    console.log(`开始搜索地址: ${targetAddress}, 链类型: ${chainType}, 模式: ${isCard ? '卡片' : '表格'}`);
    message.loading({ content: '正在获取地址信息...', key: 'addressLoading' });
    setLoading(true);
    
    try {
      let tokenList = [];
      
      if (chainType === 'ETH') {
        // 使用Etherscan API获取以太坊代币余额
        try {
          const response = await axios.get(
            `https://api.etherscan.io/api?module=account&action=tokentx&address=${targetAddress}&sort=desc&apikey=YourApiKey`
          );

          console.log('Etherscan API响应:', response.data);
          
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
          } else {
            console.log('Etherscan API返回错误状态:', response.data);
            message.warning(`获取以太坊数据失败: ${response.data.message || '未知错误'}`);
          }
        } catch (ethError) {
          console.error('Etherscan API请求失败:', ethError);
          message.warning('无法连接到Etherscan API，请稍后重试');
        }
      } else if (chainType === 'BTC') {
        // 使用mempool.space API获取比特币余额
        try {
          let btcBalance = 0;
          let apiSuccess = false;
          let errorMessages = [];
          
          // 尝试使用mempool.space API
          try {
            console.log('正在尝试mempool.space API...');
            const response = await axios.get(
              `https://mempool.space/api/address/${targetAddress}`,
              { timeout: 8000 }
            );
            btcBalance = (response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum) / 100000000;
            apiSuccess = true;
            console.log('mempool.space API成功获取数据, 余额:', btcBalance);
          } catch (mempoolError) {
            console.log('mempool.space API失败:', mempoolError.message);
            errorMessages.push(`mempool.space: ${mempoolError.message}`);
            
            // 尝试blockchain.com API
            try {
              console.log('正在尝试blockchain.com API...');
              const response = await axios.get(
                `https://blockchain.info/balance?active=${targetAddress}`,
                { timeout: 8000 }
              );
              btcBalance = response.data[targetAddress].final_balance / 100000000;
              apiSuccess = true;
              console.log('blockchain.com API成功获取数据, 余额:', btcBalance);
            } catch (blockchainError) {
              console.log('blockchain.com API失败:', blockchainError.message);
              errorMessages.push(`blockchain.com: ${blockchainError.message}`);
              
              // 尝试blockchair.com API
              try {
                console.log('正在尝试blockchair.com API...');
                const response = await axios.get(
                  `https://api.blockchair.com/bitcoin/dashboards/address/${targetAddress}`,
                  { timeout: 8000 }
                );
                btcBalance = response.data.data[targetAddress].address.balance / 100000000;
                apiSuccess = true;
                console.log('blockchair.com API成功获取数据, 余额:', btcBalance);
              } catch (blockchairError) {
                console.log('blockchair.com API失败:', blockchairError.message);
                errorMessages.push(`blockchair.com: ${blockchairError.message}`);
                
                // 尝试使用btc.com API
                try {
                  console.log('正在尝试btc.com API...');
                  const response = await axios.get(
                    `https://chain.api.btc.com/v3/address/${targetAddress}`,
                    { timeout: 8000 }
                  );
                  if (response.data.data) {
                    btcBalance = response.data.data.balance / 100000000;
                    apiSuccess = true;
                    console.log('btc.com API成功获取数据, 余额:', btcBalance);
                  } else {
                    throw new Error('返回数据格式错误');
                  }
                } catch (btcComError) {
                  console.log('btc.com API失败:', btcComError.message);
                  errorMessages.push(`btc.com: ${btcComError.message}`);
                }
              }
            }
          }
          
          if (!apiSuccess) {
            throw new Error(`无法获取地址信息，所有API都失败了: ${errorMessages.join('; ')}`);
          }
          
          // 确保使用最新的BTC价格
          let currentBtcPrice = btcPrice;
          // 如果btcPrice为0，尝试重新获取价格
          if (currentBtcPrice <= 0) {
            try {
              console.log('BTC价格为0，尝试重新获取价格...');
              const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
                timeout: 8000
              });
              currentBtcPrice = priceResponse.data.bitcoin.usd;
              console.log('获取到新的BTC价格:', currentBtcPrice);
            } catch (priceError) {
              console.log('获取BTC价格失败，使用默认值');
              currentBtcPrice = 50000; // 使用一个默认值，避免显示为0
            }
          }
          
          const btcValue = btcBalance * currentBtcPrice;
          // 确保btcBalance是数字类型
          const numericBalance = typeof btcBalance === 'string' ? parseFloat(btcBalance) : btcBalance;
          
          if (isNaN(numericBalance)) {
            console.error('无效的BTC余额:', btcBalance);
            throw new Error('获取到无效的BTC余额数据');
          }

          // 确保添加到tokenList的数据类型正确
          const btcToken = {
            key: 'btc',
            name: 'Bitcoin',
            symbol: 'BTC',
            balance: Number(numericBalance.toFixed(8)), // 确保balance是数字类型且保留8位小数
            value: Number(btcValue.toFixed(2)), // 确保value是数字类型且保留2位小数
          };
          tokenList.push(btcToken);
          console.log('添加到tokenList的BTC数据:', btcToken);
        } catch (error) {
          console.error('获取BTC余额失败:', error);
          throw error;
        }
      }

      console.log('获取到的代币列表:', tokenList);

      // 获取实时价格数据
      if (tokenList.length > 0) {
        try {
          if (chainType === 'ETH') {
            let currentEthPrice = ethPrice;
            try {
              const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
                timeout: 8000
              });
              currentEthPrice = priceResponse.data.ethereum.usd;
              console.log('获取到ETH价格:', currentEthPrice);
            } catch (ethPriceError) {
              console.log('获取ETH价格失败，使用缓存价格:', currentEthPrice);
            }
            
            tokenList = await Promise.all(tokenList.map(async (token) => {
              try {
                const tokenPriceResponse = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${token.key}&vs_currencies=usd`, {
                  timeout: 8000
                });
                const tokenPrice = tokenPriceResponse.data[token.key.toLowerCase()]?.usd || 0;
                return { ...token, value: token.balance * tokenPrice };
              } catch (tokenPriceError) {
                console.log(`获取代币${token.symbol}价格失败:`, tokenPriceError.message);
                return { ...token, value: 0 };
              }
            }));
          } else if (chainType === 'BTC') {
            // 使用当前已有的BTC价格，如果之前已经获取过
            let currentBtcPrice = btcPrice;
            if (currentBtcPrice <= 0) {
              try {
                const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
                  timeout: 8000
                });
                currentBtcPrice = priceResponse.data.bitcoin.usd;
                console.log('获取到BTC价格:', currentBtcPrice);
              } catch (btcPriceError) {
                console.log('获取BTC价格失败，使用默认值');
                // 如果无法获取价格，使用一个合理的默认值
                currentBtcPrice = currentBtcPrice || 50000;
              }
            }
            tokenList[0].value = tokenList[0].balance * currentBtcPrice;
          }
        } catch (priceError) {
          console.error('获取价格数据失败:', priceError);
          message.warning('价格数据获取失败，显示的价值可能不准确');
        }
      }

      if (isCard) {
        // 更新卡片模式的数据
        setAddressCards(prev => {
          // 创建一个新的卡片数据
          const balance = tokenList.length > 0 ? tokenList[0].balance : 0;
          const value = tokenList.length > 0 ? tokenList[0].value : 0;
          
          // 确保balance是数字类型
          const numericBalance = typeof balance === 'string' ? parseFloat(balance) : balance;
          
          const cardData = {
            address: targetAddress,
            balance: numericBalance,
            value: value
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
        // 更新表格模式的数据
        console.log('更新表格数据:', tokenList);
        setTokens(tokenList);  // 这是表格的数据源
        console.log('更新后的tokens状态:', tokens); // 调试日志
        
        // 如果没有数据，显示提示
        if (tokenList.length === 0) {
          message.info('未找到该地址的代币数据');
        }
      }
      
      // 成功获取数据后显示成功消息
      message.success({
        content: '地址数据获取成功',
        key: 'addressLoading',
        duration: 2
      });
    } catch (error) {
      console.error('获取数据失败:', error);
      message.error({
        content: error.message || '获取数据失败，请稍后重试',
        key: 'addressLoading'
      });
      
      // 确保在错误情况下也清空加载状态
      if (!isCard) {
        setTokens([]);
      }
    } finally {
      setLoading(false);
      setTimeout(() => message.destroy('addressLoading'), 2000);
    }
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
        {/* 关键修改: 添加className="search-section" */}
        <div className="search-section">
  <Row gutter={[16, 16]} align="middle" style={{ width: '100%' }}>
    <Col xs={24} sm={24} md={4} lg={3} xl={3}>
      <Select
        value={chainType}
        onChange={value => {
          setChainType(value);
          setTokens([]);
        }}
        style={{ width: '100%' }}
        options={[
          { value: 'ETH', label: '以太坊' },
          { value: 'BTC', label: '比特币' },
        ]}
      />
    </Col>
    <Col xs={24} sm={24} md={4} lg={3} xl={3}>
      <Select
        value={currency}
        onChange={setCurrency}
        style={{ width: '100%' }}
        options={[
          { value: 'USD', label: '美元 (USD)' },
          { value: 'CNY', label: '人民币 (CNY)' },
        ]}
      />
    </Col>
    <Col xs={24} sm={24} md={16} lg={18} xl={18}>
      <Input.Search
        placeholder={`请输入${chainType === 'ETH' ? '以太坊' : '比特币'}地址`}
        enterButton="搜索"
        size="large"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onSearch={() => handleSearch(address, false)}
        allowClear
        style={{ width: '100%' }}
      />
    </Col>
  </Row>
</div>
  
  <div style={{ marginBottom: '10px', fontSize: '12px', color: '#999' }}>
    当前币种: {chainType}, 数据行数: {tokens.length}
  </div>
  
  <Table
    columns={columns}
    dataSource={tokens}
    loading={loading}
    pagination={false}
    rowKey="key"
    locale={{
      emptyText: '暂无数据，请搜索一个有效地址'
    }}
  />
      </Card>
    </div>
  );
};

export default AddressExplorer;